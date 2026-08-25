import { getPool } from './db'
import { env } from './env'
import { getTableMeta, pickDisplayColumn, primaryKeyColumns } from './introspect'
import type { ColumnMeta, TableMeta } from './introspect'
import {
  buildDelete,
  buildInsert,
  buildUpdate,
  qualifiedName as qualifiedNameParts,
  quoteIdent,
  type ColumnValue,
} from './sql'
import type { JsonScalar, RowsPage } from '~/lib/types'

/**
 * Coerce a raw pg value into a JSON-safe scalar so rows can cross the
 * server-function / SSR hydration boundary without a custom serializer.
 */
export function toJsonScalar(value: unknown): JsonScalar {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') {
    const n = Number(value)
    return Number.isSafeInteger(n) ? n : value.toString()
  }
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return `\\x${value.toString('hex')}`
  return JSON.stringify(value)
}

export function toJsonRow(row: Record<string, unknown>): Record<string, JsonScalar> {
  const out: Record<string, JsonScalar> = {}
  for (const [k, v] of Object.entries(row)) {
    out[k] = toJsonScalar(v)
  }
  return out
}

/** Split a whitelisted "schema.table" id coming from introspection metadata. */
function splitTableId(id: string): { schema: string; table: string } {
  const dot = id.indexOf('.')
  if (dot === -1) {
    // bare table name, resolved against the introspected schema by caller
    return { schema: '', table: id }
  }
  return { schema: id.slice(0, dot), table: id.slice(dot + 1) }
}

function qualifiedName(meta: TableMeta): string {
  return qualifiedNameParts(meta.schema, meta.name)
}

function assertColumn(meta: TableMeta, column: string): string {
  const col = meta.columns.find((c) => c.name === column)
  if (!col) throw new Error(`Unknown column "${column}" on ${meta.id}`)
  return col.name
}

export async function listRows(opts: {
  tableId: string
  limit: number
  offset: number
  filterColumn?: string | undefined
  filterValue?: unknown
  /** column to ORDER BY — validated against introspected columns */
  orderBy?: string | undefined
  orderDir?: 'asc' | 'desc' | undefined
  /** free-text search applied as ILIKE across every column (cast to text) */
  search?: string | undefined
}): Promise<RowsPage> {
  const meta = await getTableMeta(opts.tableId)
  const pool = getPool()

  // Build the WHERE clause from an exact-match filter and/or a global search.
  // Every value is parameterized; every identifier comes from introspection.
  const conditions: Array<string> = []
  const whereParams: Array<unknown> = []

  if (opts.filterColumn !== undefined) {
    const col = assertColumn(meta, opts.filterColumn)
    whereParams.push(opts.filterValue ?? null)
    conditions.push(`${quoteIdent(col)} = $${whereParams.length}`)
  }

  const search = opts.search?.trim()
  if (search) {
    whereParams.push(`%${search}%`)
    const idx = whereParams.length
    const ors = meta.columns.map(
      (c) => `${quoteIdent(c.name)}::text ILIKE $${idx}`,
    )
    if (ors.length > 0) conditions.push(`(${ors.join(' OR ')})`)
  }

  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''

  let orderClause = ''
  if (opts.orderBy) {
    const col = assertColumn(meta, opts.orderBy)
    const dir = opts.orderDir === 'desc' ? 'DESC' : 'ASC'
    orderClause = ` ORDER BY ${quoteIdent(col)} ${dir}`
  }

  const sql = `SELECT * FROM ${qualifiedName(meta)}${where}${orderClause}
   LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`
  const rowParams = [...whereParams, opts.limit, opts.offset]

  const countSql = `SELECT count(*)::int AS total FROM ${qualifiedName(meta)}${where}`

  const [rowsRes, countRes] = await Promise.all([
    pool.query(sql, rowParams),
    pool.query(countSql, whereParams),
  ])

  return {
    rows: (rowsRes.rows as Array<Record<string, unknown>>).map(toJsonRow),
    total: countRes.rows[0]?.total ?? 0,
    limit: opts.limit,
    offset: opts.offset,
  }
}

export async function getRow(opts: {
  tableId: string
  pkColumn: string
  pkValue: unknown
}): Promise<Record<string, JsonScalar> | null> {
  const meta = await getTableMeta(opts.tableId)
  const col = assertColumn(meta, opts.pkColumn)
  const pool = getPool()
  const res = await pool.query(
    `SELECT * FROM ${qualifiedName(meta)} WHERE ${quoteIdent(col)} = $1 LIMIT 1`,
    [opts.pkValue],
  )
  const row = res.rows[0] as Record<string, unknown> | undefined
  return row ? toJsonRow(row) : null
}

/** Fetch a single row by its full (possibly composite) primary key. */
export async function getRowByPk(opts: {
  tableId: string
  pk: Record<string, JsonScalar>
}): Promise<Record<string, JsonScalar> | null> {
  const meta = await getTableMeta(opts.tableId)
  const entries = pkEntries(meta, opts.pk)
  const values: Array<unknown> = []
  const where = entries
    .map((e) => {
      values.push(e.value)
      return `${quoteIdent(e.column)} = $${values.length}`
    })
    .join(' AND ')
  const res = await getPool().query(
    `SELECT * FROM ${qualifiedName(meta)} WHERE ${where} LIMIT 1`,
    values,
  )
  const row = res.rows[0] as Record<string, unknown> | undefined
  return row ? toJsonRow(row) : null
}

/**
 * Resolve a set of referenced values to human labels for FK display.
 * Looks up the referenced table's display column for each matching row.
 */
export async function getRowLabels(opts: {
  tableId: string
  column: string
  values: Array<JsonScalar>
}): Promise<Array<{ value: JsonScalar; label: string }>> {
  if (opts.values.length === 0) return []
  const meta = await getTableMeta(opts.tableId)
  const matchCol = assertColumn(meta, opts.column)
  const displayCol = pickDisplayColumn(meta)
  const res = await getPool().query(
    `SELECT ${quoteIdent(matchCol)} AS __value, ${quoteIdent(displayCol)}::text AS __label
       FROM ${qualifiedName(meta)}
      WHERE ${quoteIdent(matchCol)} = ANY($1)`,
    [opts.values],
  )
  return (res.rows as Array<Record<string, unknown>>).map((r) => ({
    value: toJsonScalar(r.__value),
    label: r.__label === null || r.__label === undefined ? '' : String(r.__label),
  }))
}

// ---- writes ---------------------------------------------------------------

function assertWritable(): void {
  if (!env.ENGOPS_WRITE) {
    throw new Error(
      'Writes are disabled. Set ENGOPS_WRITE=1 (and use a role with write privileges) to enable create/update/delete.',
    )
  }
}

/**
 * Coerce a JSON scalar from the client into a value pg can bind. Empty strings
 * for non-text nullable columns become NULL (common form behaviour); otherwise
 * the value is passed through and pg applies the column's own type coercion.
 */
function coerceForColumn(col: ColumnMeta, value: JsonScalar): unknown {
  if (value === null) return null
  if (value === '' && col.nullable && col.udtName !== 'text' && col.udtName !== 'varchar' && col.udtName !== 'bpchar') {
    return null
  }
  return value
}

/** Writable columns for insert/update: known, not generated. */
function writableEntries(
  meta: TableMeta,
  data: Record<string, JsonScalar>,
): Array<ColumnValue> {
  return Object.entries(data)
    .map(([name, value]) => {
      const col = meta.columns.find((c) => c.name === name)
      if (!col) throw new Error(`Unknown column "${name}" on ${meta.id}`)
      if (col.isGenerated) {
        throw new Error(`Column "${name}" on ${meta.id} is generated and cannot be written`)
      }
      return { column: col.name, value: coerceForColumn(col, value) }
    })
}

/** Build the WHERE entries for a row's full primary key from a supplied map. */
function pkEntries(
  meta: TableMeta,
  pk: Record<string, JsonScalar>,
): Array<ColumnValue> {
  const cols = primaryKeyColumns(meta)
  if (cols.length === 0) {
    throw new Error(`${meta.id} has no primary key; cannot target a single row`)
  }
  return cols.map((name) => {
    if (!(name in pk)) {
      throw new Error(`Missing primary-key value for "${name}" on ${meta.id}`)
    }
    return { column: name, value: pk[name] ?? null }
  })
}

export async function createRow(opts: {
  tableId: string
  data: Record<string, JsonScalar>
}): Promise<Record<string, JsonScalar>> {
  assertWritable()
  const meta = await getTableMeta(opts.tableId)
  const q = buildInsert(qualifiedName(meta), writableEntries(meta, opts.data))
  const res = await getPool().query(q.text, q.values)
  return toJsonRow(res.rows[0] as Record<string, unknown>)
}

/** Run a single write inside a transaction, guaranteeing exactly one row. */
async function runSingleRowWrite(
  text: string,
  values: Array<unknown>,
): Promise<Record<string, JsonScalar>> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const res = await client.query(text, values)
    if (res.rowCount !== 1) {
      await client.query('ROLLBACK')
      throw new Error(
        `Expected to affect exactly 1 row but affected ${res.rowCount}; rolled back.`,
      )
    }
    await client.query('COMMIT')
    return toJsonRow(res.rows[0] as Record<string, unknown>)
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore rollback failure; surface the original error
    }
    throw err
  } finally {
    client.release()
  }
}

export async function updateRow(opts: {
  tableId: string
  pk: Record<string, JsonScalar>
  patch: Record<string, JsonScalar>
}): Promise<Record<string, JsonScalar>> {
  assertWritable()
  const meta = await getTableMeta(opts.tableId)
  const setEntries = writableEntries(meta, opts.patch)
  if (setEntries.length === 0) throw new Error('Nothing to update.')
  const q = buildUpdate(qualifiedName(meta), setEntries, pkEntries(meta, opts.pk))
  return runSingleRowWrite(q.text, q.values)
}

export async function deleteRow(opts: {
  tableId: string
  pk: Record<string, JsonScalar>
}): Promise<Record<string, JsonScalar>> {
  assertWritable()
  const meta = await getTableMeta(opts.tableId)
  const q = buildDelete(qualifiedName(meta), pkEntries(meta, opts.pk))
  return runSingleRowWrite(q.text, q.values)
}

export { quoteIdent, splitTableId }
