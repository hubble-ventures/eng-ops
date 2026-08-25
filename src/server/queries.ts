import { getPool } from './db'
import { getTableMeta } from './introspect'
import type { TableMeta } from './introspect'
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

function quoteIdent(ident: string): string {
  return '"' + ident.replaceAll('"', '""') + '"'
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
  return `${quoteIdent(meta.schema)}.${quoteIdent(meta.name)}`
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
}): Promise<RowsPage> {
  const meta = await getTableMeta(opts.tableId)
  const pool = getPool()

  const params: Array<unknown> = []
  let where = ''
  if (opts.filterColumn !== undefined) {
    const col = assertColumn(meta, opts.filterColumn)
    params.push(opts.filterValue ?? null)
    where = ` WHERE ${quoteIdent(col)} = $1`
  }

  const sql = `SELECT * FROM ${qualifiedName(meta)}${where}
   LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
  params.push(opts.limit, opts.offset)

  const countSql = `SELECT count(*)::int AS total FROM ${qualifiedName(meta)}${where}`

  const [rowsRes, countRes] = await Promise.all([
    pool.query(sql, params),
    pool.query(countSql, where ? params.slice(0, 1) : []),
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

export { quoteIdent, splitTableId }
