/**
 * Merge one row (the *loser*) into another (the *keeper*) of the same table:
 * move every row that references the loser onto the keeper, then retire the
 * emptied loser.
 *
 * Nothing here knows about any particular table. The reference graph, the
 * uniqueness rules and the notion of "these two rows say the same thing" all
 * come from `pg_catalog` via {@link introspectSchema}, so the engine works on
 * any schema it is pointed at.
 *
 * ## The shape of the problem
 *
 * 1. Discover every inbound reference to the table (declared foreign keys, plus
 *    the undiscoverable edges an operator declared in config).
 * 2. Classify collisions. Where a unique index keys on a referencing column,
 *    keeper and loser can each hold a row in one scope, and only one may
 *    survive. Rows that agree on every meaningful column are a *duplicate* —
 *    the loser's copy is dropped. Rows that disagree are a *conflict* and block
 *    the merge, naming the columns and linking to the offending rows.
 * 3. Reassign what is left.
 * 4. Sweep, then retire. Before touching the loser, assert that nothing
 *    anywhere still references it.
 *
 * Step 4 is the load-bearing one. Foreign keys are frequently ON DELETE
 * CASCADE, so a reference this code failed to find is not an error at delete
 * time — it is silent data loss. The sweep turns that into a rollback.
 *
 * ## What this cannot see
 *
 * Only *declared* constraints are discoverable. A polymorphic `owner_id`, or a
 * column that simply never got a foreign key, is invisible here: the merge
 * would reassign what it can find, sweep clean, retire the row, and leave the
 * rest dangling without an error. Operators declare those edges in
 * `engops.config.json` (see {@link tableExtraEdges}), and the UI says plainly
 * that undeclared references are not covered.
 */
import type { PoolClient } from 'pg'

import {
  mergeIgnoredColumns,
  mergeMoveWarningThreshold,
  mergeTombstoneColumns,
  tableExtraEdges,
} from './config'
import { getPool } from './db'
import {
  getTableMeta,
  introspectSchema,
  pickDisplayColumn,
  primaryKeyColumns,
  type FkAction,
  type TableMeta,
  type UniqueIndexMeta,
} from './introspect'
import { toJsonRow } from './queries'
import { qualifiedName, quoteIdent } from './sql'
import type { JsonScalar } from '~/lib/types'

// ---- plan shape -----------------------------------------------------------

export type MergeBlockCode =
  | 'same_row'
  | 'row_not_found'
  | 'not_a_table'
  | 'unsupported_primary_key'
  | 'composite_fk'
  | 'invalid_extra_edge'
  | 'unsupported_index'
  | 'conflicting_rows'
  | 'dependent_rows'
  | 'self_reference'

export type MergeWarningCode =
  | 'undeclared_references'
  | 'large_move'
  | 'triggers'
  | 'tombstone_scope'

/** A row the operator may need to open, as the record route addresses one. */
export interface MergeRowRef {
  table: string
  pkColumn: string | null
  pkValue: string | null
  /** columns that disagree, for a conflicting pair */
  columns?: Array<string>
}

export interface MergeBlock {
  code: MergeBlockCode
  message: string
  table?: string
  /** columns that disagree (conflicting_rows) */
  columns?: Array<string>
  /** rows to open and fix, most useful first */
  rows?: Array<MergeRowRef>
}

export interface MergeWarning {
  code: MergeWarningCode
  message: string
}

/** Loser-side rows the keeper already holds identically; dropped, not moved. */
export interface MergeDuplicate {
  table: string
  column: string
  /** the unique index whose scope they collide in */
  scope: string
  rows: number
}

export interface MergeMove {
  table: string
  column: string
  rows: number
  /** false for an edge declared in config rather than found in pg_constraint */
  enforced: boolean
  onDelete: FkAction | null
}

export interface MergePlan {
  table: string
  pkColumn: string
  keeperPk: string
  loserPk: string
  keeperLabel: string | null
  loserLabel: string | null
  blocks: Array<MergeBlock>
  duplicates: Array<MergeDuplicate>
  moves: Array<MergeMove>
  warnings: Array<MergeWarning>
  totalRowsMoved: number
  totalRowsDropped: number
  /** how the loser is retired once it is unreferenced */
  disposition: 'tombstone' | 'delete'
  /** the soft-delete column being stamped, when disposition is "tombstone" */
  tombstoneColumn: string | null
  /** every reference edge considered, so the operator can see the coverage */
  edges: Array<{ table: string; column: string; enforced: boolean; guard: string | null }>
  /**
   * Identifies this exact plan. The executing transaction recomputes the plan
   * and refuses to proceed if the signature moved — a preview seconds old can
   * already be stale.
   */
  signature: string
}

export interface MergeResult {
  table: string
  keeperPk: string
  loserPk: string
  rowsMoved: number
  rowsDropped: number
  tablesTouched: number
  disposition: 'tombstone' | 'delete'
  /** the loser row as it was at the moment it was retired */
  retiredRow: Record<string, JsonScalar>
}

/** A reference into the merged table, from a foreign key or from config. */
interface MergeEdge {
  /** schema-qualified id of the referencing table */
  table: string
  /** quoted "schema"."table" */
  qname: string
  /** the referencing column */
  column: string
  /** the column of the merged table it points at */
  referencedColumn: string
  /** extra SQL predicate narrowing the edge (the polymorphic case) */
  guard: string | null
  enforced: boolean
  onDelete: FkAction | null
  /** the referencing table is the merged table itself */
  selfEdge: boolean
  meta: TableMeta
}

// ---- small helpers --------------------------------------------------------

function qname(meta: TableMeta): string {
  return qualifiedName(meta.schema, meta.name)
}

/** A `$n` allocator so every value is bound and nothing is interpolated. */
function binder(values: Array<unknown>) {
  return (value: unknown): string => {
    values.push(value)
    return `$${values.length}`
  }
}

function andGuard(guard: string | null): string {
  return guard ? ` AND (${guard})` : ''
}

function andPredicate(predicate: string | null): string {
  return predicate ? ` AND (${predicate})` : ''
}

/** Human label for a row, using the table's configured/inferred display column. */
function rowLabel(meta: TableMeta, row: Record<string, JsonScalar> | null): string | null {
  if (!row) return null
  const value = row[pickDisplayColumn(meta)]
  return value === null || value === undefined ? null : String(value)
}

// ---- discovery ------------------------------------------------------------

/**
 * Every reference edge into `target`: declared foreign keys first, then the
 * edges an operator declared in config because the catalog cannot see them.
 *
 * Order is stable so a plan computed for the preview and one recomputed inside
 * the transaction are directly comparable.
 */
async function discoverEdges(
  target: TableMeta,
  blocks: Array<MergeBlock>,
): Promise<Array<MergeEdge>> {
  const { tables } = await introspectSchema()
  const byId = new Map(tables.map((t) => [t.id, t]))
  const edges: Array<MergeEdge> = []

  for (const ref of target.referencedBy) {
    const meta = byId.get(ref.fromTable)
    if (!meta) continue
    if (ref.fromColumns.length !== 1 || ref.toColumns.length !== 1) {
      // A composite key cannot be reassigned by rewriting one column: the other
      // members identify a different parent row entirely. Refuse rather than
      // guess which half to move.
      blocks.push({
        code: 'composite_fk',
        table: ref.fromTable,
        columns: ref.fromColumns,
        message: `${ref.fromTable} references ${target.id} through a composite foreign key (${ref.constraintName}, on ${ref.fromColumns.join(', ')}). This merge only reassigns single-column references — resolve it by hand.`,
      })
      continue
    }
    edges.push({
      table: ref.fromTable,
      qname: qname(meta),
      column: ref.fromColumns[0]!,
      referencedColumn: ref.toColumns[0]!,
      guard: null,
      enforced: true,
      onDelete: ref.onDelete,
      selfEdge: ref.fromTable === target.id,
      meta,
    })
  }

  const pk = primaryKeyColumns(target)[0]!
  for (const extra of tableExtraEdges(target.id)) {
    const meta = byId.get(extra.table)
    if (!meta || !meta.columns.some((c) => c.name === extra.column)) {
      // A declared edge that does not resolve is worse than no edge at all: the
      // operator believes it is covered and it silently is not.
      blocks.push({
        code: 'invalid_extra_edge',
        table: extra.table,
        message: `Config declares an extra merge edge ${extra.table}.${extra.column} for ${target.id}, but that ${meta ? 'column' : 'table'} does not exist. Fix engops.config.json.`,
      })
      continue
    }
    edges.push({
      table: extra.table,
      qname: qname(meta),
      column: extra.column,
      referencedColumn: pk,
      guard: extra.guard ?? null,
      enforced: false,
      onDelete: null,
      selfEdge: extra.table === target.id,
      meta,
    })
  }

  return edges.sort(
    (a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column),
  )
}

/**
 * Columns that decide whether two colliding rows state the same fact.
 *
 * Primary-key, identity and generated columns are excluded because they are the
 * database's bookkeeping, not the row's information — introspection knows which
 * they are, so this does not depend on their names. Only the remaining
 * exclusions (`created_at` and friends) are name-based, and those are
 * configurable per deployment and per table.
 */
function comparableColumns(meta: TableMeta, edgeColumn: string): Array<string> {
  const ignored = new Set(mergeIgnoredColumns(meta.id))
  return meta.columns
    .filter(
      (c) =>
        !c.isPrimaryKey &&
        !c.isGenerated &&
        !c.isIdentity &&
        c.name !== edgeColumn &&
        !ignored.has(c.name),
    )
    .map((c) => c.name)
}

/** Unique indexes on an edge's table whose key includes the referencing column. */
function collidingIndexes(
  edge: MergeEdge,
  edgeColumns: Set<string>,
  blocks: Array<MergeBlock>,
): Array<UniqueIndexMeta> {
  const matched: Array<UniqueIndexMeta> = []
  for (const index of edge.meta.uniqueIndexes) {
    if (index.hasExpressions) {
      // The key cannot be compared column-by-column, so a collision under it
      // cannot be classified. Refuse rather than merge past a uniqueness rule
      // this code cannot evaluate.
      if (
        index.columns.includes(edge.column) ||
        index.columns.length === 0
      ) {
        blocks.push({
          code: 'unsupported_index',
          table: edge.table,
          message: `${edge.table} has a unique expression index (${index.name}) this merge cannot evaluate. Resolve by hand.`,
        })
      }
      continue
    }
    if (!index.columns.includes(edge.column)) continue
    const keyed = index.columns.filter((c) => edgeColumns.has(c))
    if (keyed.length > 1) {
      // e.g. UNIQUE (user_a, user_b) — merging one of the pair into the other
      // changes both sides of the scope at once. Not something to guess at.
      blocks.push({
        code: 'unsupported_index',
        table: edge.table,
        columns: keyed,
        message: `${edge.table}'s unique index ${index.name} keys on more than one column referencing ${edge.referencedColumn} (${keyed.join(', ')}). Merging would rewrite both sides of the same scope — resolve by hand.`,
      })
      continue
    }
    matched.push(index)
  }
  return matched
}

// ---- collision classification ---------------------------------------------

interface CollisionOutcome {
  pairs: number
  conflicts: number
  diffColumns: Array<string>
  conflictRows: Array<{ loser: string | null; keeper: string | null; diff: Array<string> }>
}

/**
 * Compare the keeper's and the loser's rows inside one unique scope.
 *
 * Equality follows the index's own null semantics: Postgres treats NULLs as
 * distinct by default, so `=` is the correct scope test unless the index is
 * NULLS NOT DISTINCT. Using `IS NOT DISTINCT FROM` unconditionally would invent
 * collisions between rows Postgres considers perfectly unique.
 *
 * A partial index's predicate is applied to *both* sides — rows outside it are
 * not under the rule and cannot collide.
 */
async function classifyCollisions(
  client: PoolClient,
  edge: MergeEdge,
  index: UniqueIndexMeta,
  keeperValue: unknown,
  loserValue: unknown,
): Promise<CollisionOutcome> {
  const values: Array<unknown> = []
  const bind = binder(values)
  const col = quoteIdent(edge.column)
  const loserParam = bind(loserValue)
  const keeperParam = bind(keeperValue)
  const scope = `${andGuard(edge.guard)}${andPredicate(index.predicate)}`

  const scopeColumns = index.columns.filter((c) => c !== edge.column)
  const equality = index.nullsNotDistinct ? 'IS NOT DISTINCT FROM' : '='
  const joinOn =
    scopeColumns.length > 0
      ? scopeColumns
          .map((c) => `l.${quoteIdent(c)} ${equality} k.${quoteIdent(c)}`)
          .join(' AND ')
      : 'true'

  const pkCols = primaryKeyColumns(edge.meta)
  // Deep links address a row by a single primary-key value; a composite or
  // absent key simply yields no link, never a wrong one.
  const pkExpr = pkCols.length === 1 ? quoteIdent(pkCols[0]!) : null
  const lpk = pkExpr ? `l.${pkExpr}::text` : 'NULL::text'
  const kpk = pkExpr ? `k.${pkExpr}::text` : 'NULL::text'

  const compare = comparableColumns(edge.meta, edge.column)
  const diffExpr =
    compare.length > 0
      ? `array_remove(ARRAY[${compare
          .map(
            (c) =>
              `CASE WHEN l.${quoteIdent(c)} IS DISTINCT FROM k.${quoteIdent(c)} THEN ${bind(c)} END`,
          )
          .join(', ')}]::text[], NULL)`
      : `ARRAY[]::text[]`

  const text = `
    WITH l AS (SELECT * FROM ${edge.qname} WHERE ${col} = ${loserParam}${scope}),
         k AS (SELECT * FROM ${edge.qname} WHERE ${col} = ${keeperParam}${scope}),
         j AS (
           SELECT ${lpk} AS __lpk, ${kpk} AS __kpk, ${diffExpr} AS __diff
             FROM l JOIN k ON ${joinOn}
         )
    SELECT count(*)::int AS pairs,
           count(*) FILTER (WHERE cardinality(__diff) > 0)::int AS conflicts,
           (SELECT coalesce(array_agg(DISTINCT d), ARRAY[]::text[])
              FROM j, unnest(j.__diff) AS d) AS diff_columns,
           (SELECT coalesce(json_agg(x), '[]'::json) FROM (
              SELECT __lpk, __kpk, __diff FROM j
               WHERE cardinality(__diff) > 0 LIMIT 5) x) AS conflict_rows
      FROM j`

  const res = await client.query(text, values)
  const row = res.rows[0] as
    | {
        pairs: number
        conflicts: number
        diff_columns: Array<string> | null
        conflict_rows: Array<{ __lpk: string | null; __kpk: string | null; __diff: Array<string> }>
      }
    | undefined

  return {
    pairs: Number(row?.pairs ?? 0),
    conflicts: Number(row?.conflicts ?? 0),
    diffColumns: row?.diff_columns ?? [],
    conflictRows: (row?.conflict_rows ?? []).map((r) => ({
      loser: r.__lpk,
      keeper: r.__kpk,
      diff: r.__diff ?? [],
    })),
  }
}

/**
 * Rows in other tables that hang off the loser's colliding rows.
 *
 * Dropping a "duplicate" is only safe when nothing references it. In the
 * dataset this engine was modelled on, two rows were identical in every
 * comparable column — but a child table referenced one of them ON DELETE
 * CASCADE, and dropping it would have silently destroyed a person's
 * competition enrollments and team membership.
 *
 * The top-level sweep cannot catch this: those children reference the colliding
 * row's own id, not the merged row's. So the check has to happen here, before
 * anything is deleted. Composite child keys are compared as row values, so a
 * multi-column foreign key is matched in full rather than on its first column.
 */
async function dependentRowCounts(
  client: PoolClient,
  edge: MergeEdge,
  index: UniqueIndexMeta,
  keeperValue: unknown,
  loserValue: unknown,
): Promise<Array<{ table: string; column: string; onDelete: FkAction; rows: number }>> {
  const { tables } = await introspectSchema()
  const byId = new Map(tables.map((t) => [t.id, t]))
  const scopeColumns = index.columns.filter((c) => c !== edge.column)
  const equality = index.nullsNotDistinct ? 'IS NOT DISTINCT FROM' : '='
  const joinOn =
    scopeColumns.length > 0
      ? scopeColumns
          .map((c) => `l.${quoteIdent(c)} ${equality} k.${quoteIdent(c)}`)
          .join(' AND ')
      : 'true'
  const scope = `${andGuard(edge.guard)}${andPredicate(index.predicate)}`
  const col = quoteIdent(edge.column)

  const found: Array<{ table: string; column: string; onDelete: FkAction; rows: number }> = []
  for (const ref of edge.meta.referencedBy) {
    const childMeta = byId.get(ref.fromTable)
    if (!childMeta) continue
    const values: Array<unknown> = []
    const bind = binder(values)
    const loserParam = bind(loserValue)
    const keeperParam = bind(keeperValue)
    const childCols = ref.fromColumns.map((c) => `d.${quoteIdent(c)}`).join(', ')
    const parentCols = ref.toColumns.map((c) => `l.${quoteIdent(c)}`).join(', ')
    const text = `
      SELECT count(*)::int AS rows
        FROM ${qname(childMeta)} d
        JOIN ${edge.qname} l ON (${childCols}) = (${parentCols})
       WHERE l.${col} = ${loserParam}${scope}
         AND EXISTS (
           SELECT 1 FROM ${edge.qname} k
            WHERE k.${col} = ${keeperParam}${scope} AND ${joinOn}
         )`
    const res = await client.query(text, values)
    const rows = Number((res.rows[0] as { rows: number } | undefined)?.rows ?? 0)
    if (rows > 0) {
      found.push({
        table: ref.fromTable,
        column: ref.fromColumns.join(', '),
        onDelete: ref.onDelete,
        rows,
      })
    }
  }
  return found
}

// ---- plan -----------------------------------------------------------------

function signPlan(plan: Omit<MergePlan, 'signature'>): string {
  return JSON.stringify({
    blocks: plan.blocks.map((b) => [b.code, b.table ?? '', (b.columns ?? []).join(',')]),
    duplicates: plan.duplicates.map((d) => [d.table, d.column, d.scope, d.rows]),
    moves: plan.moves.map((m) => [m.table, m.column, m.rows]),
    disposition: plan.disposition,
  })
}

async function fetchRow(
  client: PoolClient,
  meta: TableMeta,
  pkColumn: string,
  value: string,
): Promise<Record<string, JsonScalar> | null> {
  const res = await client.query(
    `SELECT * FROM ${qname(meta)} WHERE ${quoteIdent(pkColumn)} = $1 LIMIT 1`,
    [value],
  )
  const row = res.rows[0] as Record<string, unknown> | undefined
  return row ? toJsonRow(row) : null
}

/** Non-internal triggers on the tables a merge would write to. */
async function triggerWarning(
  client: PoolClient,
  tableIds: Array<string>,
): Promise<MergeWarning | null> {
  if (tableIds.length === 0) return null
  const res = await client.query<{ id: string; tgname: string }>(
    `SELECT n.nspname || '.' || c.relname AS id, t.tgname
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal
        AND n.nspname || '.' || c.relname = ANY($1)
      ORDER BY 1, 2`,
    [tableIds],
  )
  if (res.rows.length === 0) return null
  const names = res.rows.map((r) => `${r.id}.${r.tgname}`)
  return {
    code: 'triggers',
    message: `Reassignment fires ${names.length} trigger${names.length === 1 ? '' : 's'} this tool cannot reason about: ${names.join(', ')}. Whatever they do — audit rows, denormalised counters, outbound webhooks — happens as part of the merge.`,
  }
}

/**
 * Build the plan: what moves, what is dropped as a duplicate, and what blocks
 * the merge outright.
 *
 * Runs against whatever client it is given, so the preview and the
 * in-transaction recompute share one implementation and cannot drift.
 */
export async function computeMergePlan(
  client: PoolClient,
  tableId: string,
  keeperPk: string,
  loserPk: string,
): Promise<MergePlan> {
  const target = await getTableMeta(tableId)
  const blocks: Array<MergeBlock> = []
  const warnings: Array<MergeWarning> = []
  const pkCols = primaryKeyColumns(target)
  const pkColumn = pkCols[0] ?? ''

  const base = {
    table: target.id,
    pkColumn,
    keeperPk,
    loserPk,
    keeperLabel: null as string | null,
    loserLabel: null as string | null,
    duplicates: [] as Array<MergeDuplicate>,
    moves: [] as Array<MergeMove>,
    warnings,
    totalRowsMoved: 0,
    totalRowsDropped: 0,
    disposition: 'delete' as 'tombstone' | 'delete',
    tombstoneColumn: null as string | null,
    edges: [] as MergePlan['edges'],
  }
  const bail = (): MergePlan => {
    const plan = { ...base, blocks }
    return { ...plan, signature: signPlan(plan) }
  }

  if (target.kind !== 'table') {
    blocks.push({
      code: 'not_a_table',
      table: target.id,
      message: `${target.id} is a ${target.kind}; only tables can be merged.`,
    })
    return bail()
  }
  if (pkCols.length !== 1) {
    blocks.push({
      code: 'unsupported_primary_key',
      table: target.id,
      message:
        pkCols.length === 0
          ? `${target.id} has no primary key, so its rows cannot be addressed individually.`
          : `${target.id} has a composite primary key (${pkCols.join(', ')}). Merging is only supported for a single-column key.`,
    })
    return bail()
  }
  if (keeperPk === loserPk) {
    blocks.push({ code: 'same_row', message: 'Pick two different rows to merge.' })
    return bail()
  }

  const [keeperRow, loserRow] = await Promise.all([
    fetchRow(client, target, pkColumn, keeperPk),
    fetchRow(client, target, pkColumn, loserPk),
  ])
  base.keeperLabel = rowLabel(target, keeperRow)
  base.loserLabel = rowLabel(target, loserRow)
  for (const [role, row, pk] of [
    ['keeper', keeperRow, keeperPk],
    ['loser', loserRow, loserPk],
  ] as const) {
    if (!row) {
      blocks.push({
        code: 'row_not_found',
        table: target.id,
        message: `No ${role} row in ${target.id} where ${pkColumn} = ${pk}.`,
      })
    }
  }
  if (!keeperRow || !loserRow) return bail()

  // How the loser is retired. A soft-delete column keeps the row readable after
  // the merge; without one the row is deleted and returned to the caller so
  // what was destroyed is at least recorded.
  const tombstone = mergeTombstoneColumns(target.id).find((name) =>
    target.columns.some((c) => c.name === name && c.nullable),
  )
  base.tombstoneColumn = tombstone ?? null
  base.disposition = tombstone ? 'tombstone' : 'delete'

  const edges = await discoverEdges(target, blocks)
  base.edges = edges.map((e) => ({
    table: e.table,
    column: e.column,
    enforced: e.enforced,
    guard: e.guard,
  }))
  const edgeColumnsByTable = new Map<string, Set<string>>()
  for (const edge of edges) {
    const set = edgeColumnsByTable.get(edge.table) ?? new Set<string>()
    set.add(edge.column)
    edgeColumnsByTable.set(edge.table, set)
  }

  // Merging along a self-reference can point the keeper at itself. Nothing
  // downstream would complain — a self-parent is a perfectly valid row — so it
  // has to be refused here.
  for (const edge of edges.filter((e) => e.selfEdge)) {
    const res = await client.query(
      `SELECT count(*)::int AS rows FROM ${edge.qname}
        WHERE ${quoteIdent(edge.column)} = $1
          AND ${quoteIdent(pkColumn)} = $2${andGuard(edge.guard)}`,
      [loserRow[edge.referencedColumn] ?? null, keeperPk],
    )
    if (Number((res.rows[0] as { rows: number }).rows) > 0) {
      blocks.push({
        code: 'self_reference',
        table: edge.table,
        columns: [edge.column],
        message: `The keeper's ${edge.column} points at the row being merged away, so the merge would leave it referencing itself. Clear or repoint ${target.id}.${edge.column} on the keeper first.`,
        rows: [{ table: target.id, pkColumn, pkValue: keeperPk }],
      })
    }
  }

  const duplicates: Array<MergeDuplicate> = []
  for (const edge of edges) {
    const keeperValue = keeperRow[edge.referencedColumn] ?? null
    const loserValue = loserRow[edge.referencedColumn] ?? null
    if (loserValue === null) continue // nothing can reference a NULL

    const indexes = collidingIndexes(
      edge,
      edgeColumnsByTable.get(edge.table) ?? new Set(),
      blocks,
    )
    for (const index of indexes) {
      const outcome = await classifyCollisions(
        client,
        edge,
        index,
        keeperValue,
        loserValue,
      )
      if (outcome.pairs === 0) continue

      if (outcome.conflicts > 0) {
        const childPk = primaryKeyColumns(edge.meta)
        const pkCol = childPk.length === 1 ? childPk[0]! : null
        blocks.push({
          code: 'conflicting_rows',
          table: edge.table,
          columns: outcome.diffColumns,
          message: `Both rows have a ${edge.table} row in the same unique scope (${index.name}) and they disagree on ${outcome.diffColumns.join(', ')}. Reconcile or remove one, then retry.`,
          rows: outcome.conflictRows.flatMap((pair) =>
            [pair.loser, pair.keeper]
              .filter((v): v is string => v !== null)
              .map((value) => ({
                table: edge.table,
                pkColumn: pkCol,
                pkValue: value,
                columns: pair.diff,
              })),
          ),
        })
        continue
      }

      // The rows say the same thing — but the loser's copy may still be
      // load-bearing for rows that hang off it.
      const dependents = await dependentRowCounts(
        client,
        edge,
        index,
        keeperValue,
        loserValue,
      )
      if (dependents.length > 0) {
        const detail = dependents
          .map((d) => `${d.rows} × ${d.table}.${d.column} (ON DELETE ${d.onDelete})`)
          .join(', ')
        blocks.push({
          code: 'dependent_rows',
          table: edge.table,
          message: `Both rows have an otherwise-identical ${edge.table} row in the same unique scope (${index.name}), but the copy being dropped still has rows attached — ${detail} — which dropping it would take with it. Reassign or remove those first, then retry.`,
        })
        continue
      }

      duplicates.push({
        table: edge.table,
        column: edge.column,
        scope: index.name,
        rows: outcome.pairs,
      })
    }
  }

  // Rows dropped as duplicates are not also moved. Without this the preview
  // double-counts them — reporting one row as both moved and dropped — which is
  // exactly the number the operator is asked to confirm against. `max(0, …)`
  // covers a row classified as a duplicate by two indexes at once: it is
  // deleted once, so the summed drop count can exceed the rows that exist.
  const droppedByEdge = new Map<string, number>()
  for (const d of duplicates) {
    const key = `${d.table}.${d.column}`
    droppedByEdge.set(key, (droppedByEdge.get(key) ?? 0) + d.rows)
  }

  const moves: Array<MergeMove> = []
  for (const edge of edges) {
    const loserValue = loserRow[edge.referencedColumn] ?? null
    if (loserValue === null) continue
    const values: Array<unknown> = []
    const bind = binder(values)
    const loserParam = bind(loserValue)
    // A self-edge never rewrites the retiring row's own column: that row is
    // being taken out of service, not reassigned, and a tombstone should keep
    // its data as it was.
    const exclude = edge.selfEdge
      ? ` AND ${quoteIdent(pkColumn)} IS DISTINCT FROM ${bind(loserPk)}`
      : ''
    const res = await client.query(
      `SELECT count(*)::int AS rows FROM ${edge.qname}
        WHERE ${quoteIdent(edge.column)} = ${loserParam}${andGuard(edge.guard)}${exclude}`,
      values,
    )
    const referencing = Number((res.rows[0] as { rows: number }).rows)
    const rows = Math.max(0, referencing - (droppedByEdge.get(`${edge.table}.${edge.column}`) ?? 0))
    if (rows > 0) {
      moves.push({
        table: edge.table,
        column: edge.column,
        rows,
        enforced: edge.enforced,
        onDelete: edge.onDelete,
      })
    }
  }

  // ---- warnings (advisory; they never block) ----
  warnings.push({
    code: 'undeclared_references',
    message: `Only declared foreign keys are discoverable${
      edges.some((e) => !e.enforced)
        ? `, plus the ${edges.filter((e) => !e.enforced).length} extra edge(s) declared in config`
        : ''
    }. A column that references ${target.id} without a constraint — a polymorphic owner, or one that simply never got one — is invisible here: it will not be reassigned, the sweep will not see it, and it will be left dangling.`,
  })

  const threshold = mergeMoveWarningThreshold()
  for (const move of moves) {
    if (move.rows >= threshold) {
      warnings.push({
        code: 'large_move',
        message: `${move.table}.${move.column} reassigns ${move.rows.toLocaleString()} rows in a single UPDATE, holding row locks on all of them for the length of the transaction.`,
      })
    }
  }

  const trigger = await triggerWarning(client, [
    ...new Set([...moves.map((m) => m.table), ...duplicates.map((d) => d.table), target.id]),
  ])
  if (trigger) warnings.push(trigger)

  if (base.disposition === 'tombstone') {
    warnings.push({
      code: 'tombstone_scope',
      message: `${loserPk} will be stamped ${base.tombstoneColumn} rather than deleted, so the row still exists — it keeps occupying any unique scope on ${target.id} it currently holds (a unique email, say), and anything that queries this table without filtering on ${base.tombstoneColumn} still sees it.`,
    })
  }

  const plan = {
    ...base,
    blocks,
    duplicates,
    moves,
    totalRowsMoved: moves.reduce((n, m) => n + m.rows, 0),
    totalRowsDropped: duplicates.reduce((n, d) => n + d.rows, 0),
  }
  return { ...plan, signature: signPlan(plan) }
}

/** Compute a plan on a pooled connection (the preview path). */
export async function previewMerge(
  tableId: string,
  keeperPk: string,
  loserPk: string,
): Promise<MergePlan> {
  const client = await getPool().connect()
  try {
    return await computeMergePlan(client, tableId, keeperPk, loserPk)
  } finally {
    client.release()
  }
}

// ---- execution ------------------------------------------------------------

/**
 * Execute the merge in one transaction.
 *
 * Both rows are locked first, in primary-key order, so two merges naming the
 * same pair in opposite directions cannot deadlock. The plan is then recomputed
 * *inside* the transaction and compared against the one the operator confirmed:
 * a preview computed seconds ago can already be stale, and a concurrent write
 * could otherwise slip a new conflict past it.
 */
export async function mergeRows(opts: {
  tableId: string
  keeperPk: string
  loserPk: string
  /** the signature of the plan the operator confirmed */
  expectedSignature: string
}): Promise<MergeResult> {
  const target = await getTableMeta(opts.tableId)
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')

    const pkColumn = primaryKeyColumns(target)[0]
    if (!pkColumn) throw new Error(`${target.id} has no primary key; cannot merge.`)
    await client.query(
      `SELECT ${quoteIdent(pkColumn)} FROM ${qname(target)}
        WHERE ${quoteIdent(pkColumn)} IN ($1, $2)
        ORDER BY ${quoteIdent(pkColumn)}
        FOR UPDATE`,
      [opts.keeperPk, opts.loserPk],
    )

    const plan = await computeMergePlan(client, opts.tableId, opts.keeperPk, opts.loserPk)
    if (plan.blocks.length > 0) {
      throw new Error(`Merge blocked: ${plan.blocks.map((b) => b.message).join(' ')}`)
    }
    if (plan.signature !== opts.expectedSignature) {
      throw new Error(
        'The database changed since this plan was previewed, so it was not applied. Review the new plan and confirm again.',
      )
    }

    const keeperRow = await fetchRow(client, target, pkColumn, opts.keeperPk)
    const loserRow = await fetchRow(client, target, pkColumn, opts.loserPk)
    if (!keeperRow || !loserRow) throw new Error('Both rows must exist to merge.')

    const edges = await discoverEdges(target, [])
    const edgeColumnsByTable = new Map<string, Set<string>>()
    for (const edge of edges) {
      const set = edgeColumnsByTable.get(edge.table) ?? new Set<string>()
      set.add(edge.column)
      edgeColumnsByTable.set(edge.table, set)
    }

    // 1. Drop the loser's side of every duplicate. Doing this first is what lets
    //    the reassignment below run without tripping the unique index.
    let rowsDropped = 0
    for (const edge of edges) {
      const keeperValue = keeperRow[edge.referencedColumn] ?? null
      const loserValue = loserRow[edge.referencedColumn] ?? null
      if (loserValue === null) continue
      for (const index of collidingIndexes(
        edge,
        edgeColumnsByTable.get(edge.table) ?? new Set(),
        [],
      )) {
        const values: Array<unknown> = []
        const bind = binder(values)
        const loserParam = bind(loserValue)
        const keeperParam = bind(keeperValue)
        const scope = `${andGuard(edge.guard)}${andPredicate(index.predicate)}`
        const scopeColumns = index.columns.filter((c) => c !== edge.column)
        const equality = index.nullsNotDistinct ? 'IS NOT DISTINCT FROM' : '='
        const joinOn =
          scopeColumns.length > 0
            ? scopeColumns
                .map((c) => `l.${quoteIdent(c)} ${equality} k.${quoteIdent(c)}`)
                .join(' AND ')
            : 'true'
        const res = await client.query(
          `WITH k AS (
             SELECT * FROM ${edge.qname} WHERE ${quoteIdent(edge.column)} = ${keeperParam}${scope}
           ), doomed AS (
             DELETE FROM ${edge.qname} l
              WHERE l.${quoteIdent(edge.column)} = ${loserParam}${scope}
                AND EXISTS (SELECT 1 FROM k WHERE ${joinOn})
             RETURNING 1
           )
           SELECT count(*)::int AS rows FROM doomed`,
          values,
        )
        rowsDropped += Number((res.rows[0] as { rows: number }).rows)
      }
    }

    // 2. Reassign everything that is left.
    let rowsMoved = 0
    const tablesTouched = new Set<string>()
    for (const edge of edges) {
      const keeperValue = keeperRow[edge.referencedColumn] ?? null
      const loserValue = loserRow[edge.referencedColumn] ?? null
      if (loserValue === null) continue
      const values: Array<unknown> = []
      const bind = binder(values)
      const keeperParam = bind(keeperValue)
      const loserParam = bind(loserValue)
      const exclude = edge.selfEdge
        ? ` AND ${quoteIdent(pkColumn)} IS DISTINCT FROM ${bind(opts.loserPk)}`
        : ''
      const res = await client.query(
        `WITH moved AS (
           UPDATE ${edge.qname} SET ${quoteIdent(edge.column)} = ${keeperParam}
            WHERE ${quoteIdent(edge.column)} = ${loserParam}${andGuard(edge.guard)}${exclude}
           RETURNING 1
         )
         SELECT count(*)::int AS rows FROM moved`,
        values,
      )
      const rows = Number((res.rows[0] as { rows: number }).rows)
      if (rows > 0) {
        rowsMoved += rows
        tablesTouched.add(edge.table)
      }
    }

    // 3. Sweep. Foreign keys are frequently ON DELETE CASCADE, so a reference
    //    missed above would not raise at step 4 — it would be silently deleted
    //    along with the row. This check is what turns that into a rollback.
    for (const edge of edges) {
      const loserValue = loserRow[edge.referencedColumn] ?? null
      if (loserValue === null) continue
      const values: Array<unknown> = []
      const bind = binder(values)
      const loserParam = bind(loserValue)
      const exclude = edge.selfEdge
        ? ` AND ${quoteIdent(pkColumn)} IS DISTINCT FROM ${bind(opts.loserPk)}`
        : ''
      const res = await client.query(
        `SELECT count(*)::int AS rows FROM ${edge.qname}
          WHERE ${quoteIdent(edge.column)} = ${loserParam}${andGuard(edge.guard)}${exclude}`,
        values,
      )
      const remaining = Number((res.rows[0] as { rows: number }).rows)
      if (remaining > 0) {
        throw new Error(
          `Merge sweep failed: ${remaining} row(s) still reference ${opts.loserPk} via ${edge.table}.${edge.column}. Rolled back.`,
        )
      }
    }

    // 4. The loser is unreferenced. Retire it — stamped if the table has a
    //    soft-delete column, deleted otherwise. Either way the row as it stood
    //    is returned, so what was retired is on the record.
    const retire = plan.tombstoneColumn
      ? await client.query(
          `UPDATE ${qname(target)} SET ${quoteIdent(plan.tombstoneColumn)} = now()
            WHERE ${quoteIdent(pkColumn)} = $1 RETURNING *`,
          [opts.loserPk],
        )
      : await client.query(
          `DELETE FROM ${qname(target)} WHERE ${quoteIdent(pkColumn)} = $1 RETURNING *`,
          [opts.loserPk],
        )
    if (retire.rowCount !== 1) {
      throw new Error(
        `Expected to retire exactly 1 row, affected ${retire.rowCount}. Rolled back.`,
      )
    }

    await client.query('COMMIT')
    return {
      table: target.id,
      keeperPk: opts.keeperPk,
      loserPk: opts.loserPk,
      rowsMoved,
      rowsDropped,
      tablesTouched: tablesTouched.size,
      disposition: plan.disposition,
      retiredRow: toJsonRow(retire.rows[0] as Record<string, unknown>),
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // surface the original failure, not the rollback's
    }
    throw err
  } finally {
    client.release()
  }
}
