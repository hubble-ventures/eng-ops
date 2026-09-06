/**
 * Look for references to a row that no constraint declares.
 *
 * A merge can only reassign edges it can discover, and `pg_constraint` only
 * knows about declared foreign keys. A polymorphic `owner_id`, or a column that
 * simply never got a constraint, is invisible: the merge reassigns what it
 * finds, sweeps clean, retires the row, and leaves the rest pointing at an id
 * that is gone — with no error anywhere. It is the one way the merge engine
 * fails *open* rather than closed.
 *
 * This module is the mitigation, and it deliberately does not work by guessing
 * at column names. The reference implementation this was modelled on had
 * undeclared references called `user_ref`, `user`, `coach_id` and `owner_id`; a
 * name heuristic finds some of those and invents a pile of false positives out
 * of denormalised and external ids. For the one failure mode where the tool can
 * be confidently wrong, a scanner that produces false confidence is worse than
 * no scanner.
 *
 * So it asks the data instead: **which columns actually contain the value about
 * to be retired?** That turns "here are forty suspicious columns" into "these
 * two hold the id you are about to delete."
 */
import { getPool } from './db'
import {
  getTableMeta,
  introspectSchema,
  primaryKeyColumns,
  type ColumnMeta,
  type TableMeta,
} from './introspect'
import { tableExtraEdges } from './config'
import { qualifiedName, quoteIdent } from './sql'

export interface ScanHit {
  table: string
  column: string
  /** rows in that column holding the scanned value */
  rows: number
  /**
   * How much a match here means. A uuid or text id that appears somewhere it
   * was never declared is close to conclusive; an integer is not — plenty of
   * columns legitimately contain the number 4.
   */
  confidence: 'strong' | 'weak'
}

export interface ScanSkip {
  table: string
  reason: 'timeout' | 'error'
  detail: string
}

export interface ScanResult {
  table: string
  pkColumn: string
  pkValue: string
  /** the type every candidate column had to match */
  pkType: string
  hits: Array<ScanHit>
  /** tables that could not be scanned, so the gap is visible rather than silent */
  skipped: Array<ScanSkip>
  tablesScanned: number
  columnsScanned: number
  elapsedMs: number
  /**
   * A ready-to-paste `merge.extraEdges` fragment for the hits, so the operator
   * can close the loop without hand-writing config. Null when there are none.
   */
  suggestedConfig: string | null
}

/**
 * Columns worth probing.
 *
 * Three exclusions do almost all the precision work, and none of them is a
 * guess about naming:
 *
 * - **Anything already declared** — a column with a foreign key to the target,
 *   or an extra edge in config, is covered; that is the whole point.
 * - **Any column that has a foreign key at all**, to anywhere. A column
 *   constrained to another table is not an undeclared reference to this one.
 *   This is what stops `team_id` and `post_id` from showing up in every scan.
 * - **Primary keys.** A serial `id` contains the value 4 in almost every table
 *   in the database. A primary key is its table's identity, not a reference.
 *
 * The type filter is exact (`udtName`), which keeps precision up and also means
 * one bind parameter can be compared natively against every candidate — no
 * `::text` casts, so an index on the column can still be used.
 */
function candidateColumns(
  target: TableMeta,
  targetPk: ColumnMeta,
  tables: Array<TableMeta>,
): Map<string, { meta: TableMeta; columns: Array<string> }> {
  const declared = new Set<string>()
  for (const ref of target.referencedBy) {
    for (const column of ref.fromColumns) declared.add(`${ref.fromTable}.${column}`)
  }
  for (const edge of tableExtraEdges(target.id)) {
    declared.add(`${edge.table}.${edge.column}`)
  }

  const out = new Map<string, { meta: TableMeta; columns: Array<string> }>()
  for (const meta of tables) {
    // Views and materialized views are derived: a stale id in one is fixed by
    // refreshing it, not by reassigning a row, so reporting them would be noise.
    if (meta.kind !== 'table') continue
    const constrained = new Set(meta.foreignKeys.flatMap((fk) => fk.columns))
    const columns = meta.columns
      .filter(
        (c) =>
          c.udtName === targetPk.udtName &&
          !c.isPrimaryKey &&
          !constrained.has(c.name) &&
          !declared.has(`${meta.id}.${c.name}`),
      )
      .map((c) => c.name)
    if (columns.length > 0) out.set(meta.id, { meta, columns })
  }
  return out
}

/** Integer ids collide with ordinary numbers; wide/opaque ids essentially do not. */
function confidenceFor(udtName: string): 'strong' | 'weak' {
  return ['int2', 'int4', 'int8', 'numeric', 'float4', 'float8'].includes(udtName)
    ? 'weak'
    : 'strong'
}

function renderSuggestion(target: string, hits: Array<ScanHit>): string | null {
  if (hits.length === 0) return null
  const edges = hits.map((h) => ({ table: h.table, column: h.column, guard: null }))
  return JSON.stringify(
    { tables: { [target]: { merge: { extraEdges: edges } } } },
    null,
    2,
  )
}

/**
 * Scan every table for columns holding `pkValue` that nothing declares.
 *
 * One query per table rather than one per column: a table is scanned once and
 * every candidate column on it is counted in the same pass, which turns N
 * sequential scans into one. Each is bounded by `statement_timeout` so a single
 * huge table cannot hang the request — a table that times out is *reported*,
 * never silently dropped, because a scan that quietly skipped something is the
 * same false confidence this module exists to avoid.
 */
export async function scanUndeclaredReferences(opts: {
  tableId: string
  pkValue: string
  timeoutMs?: number
}): Promise<ScanResult> {
  const started = Date.now()
  const target = await getTableMeta(opts.tableId)
  const pkName = primaryKeyColumns(target)[0]
  const targetPk = target.columns.find((c) => c.name === pkName)
  if (!targetPk) {
    throw new Error(`${target.id} has no single-column primary key to scan for.`)
  }

  const { tables } = await introspectSchema()
  const candidates = candidateColumns(target, targetPk, tables)

  const hits: Array<ScanHit> = []
  const skipped: Array<ScanSkip> = []
  let columnsScanned = 0

  const client = await getPool().connect()
  try {
    await client.query(`SET statement_timeout = ${Number(opts.timeoutMs ?? 15_000)}`)
    for (const [tableId, { meta, columns }] of candidates) {
      columnsScanned += columns.length
      const selects = columns
        .map(
          (c, i) =>
            `count(*) FILTER (WHERE ${quoteIdent(c)} = $1)::int AS ${quoteIdent(`c${i}`)}`,
        )
        .join(', ')
      try {
        const res = await client.query(
          `SELECT ${selects} FROM ${qualifiedName(meta.schema, meta.name)}`,
          [opts.pkValue],
        )
        const row = res.rows[0] as Record<string, number> | undefined
        columns.forEach((column, i) => {
          const rows = Number(row?.[`c${i}`] ?? 0)
          if (rows > 0) {
            hits.push({
              table: tableId,
              column,
              rows,
              confidence: confidenceFor(targetPk.udtName),
            })
          }
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        skipped.push({
          table: tableId,
          reason: /statement timeout/i.test(message) ? 'timeout' : 'error',
          detail: message,
        })
      }
    }
  } finally {
    try {
      await client.query('SET statement_timeout = DEFAULT')
    } catch {
      // the connection is going back to the pool either way
    }
    client.release()
  }

  hits.sort((a, b) => b.rows - a.rows || a.table.localeCompare(b.table))

  return {
    table: target.id,
    pkColumn: targetPk.name,
    pkValue: opts.pkValue,
    pkType: targetPk.dataType,
    hits,
    skipped,
    tablesScanned: candidates.size,
    columnsScanned,
    elapsedMs: Date.now() - started,
    suggestedConfig: renderSuggestion(target.id, hits),
  }
}
