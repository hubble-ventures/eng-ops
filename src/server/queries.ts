import { getPool } from './db'
import { getTableMeta } from './introspect'
import type { TableMeta } from './introspect'
import type { FilterSpec, JsonScalar, RowsPage, SortSpec } from '~/lib/types'

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

/**
 * Build the `WHERE` predicate list for the given filters + free-text search,
 * appending bound values to `params`. Every column name is validated against
 * introspected metadata and safely quoted; only values are parameterized.
 */
function buildConditions(
  meta: TableMeta,
  filters: Array<FilterSpec>,
  search: string | undefined,
  params: Array<unknown>,
): Array<string> {
  const conds: Array<string> = []

  for (const f of filters) {
    const q = quoteIdent(assertColumn(meta, f.column))
    switch (f.op) {
      case 'is_null':
        conds.push(`${q} IS NULL`)
        break
      case 'is_not_null':
        conds.push(`${q} IS NOT NULL`)
        break
      case 'ilike':
        params.push(`%${f.value ?? ''}%`)
        conds.push(`${q}::text ILIKE $${params.length}`)
        break
      case 'eq':
        params.push(f.value ?? null)
        conds.push(`${q} = $${params.length}`)
        break
      case 'neq':
        params.push(f.value ?? null)
        conds.push(`${q} <> $${params.length}`)
        break
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const sqlOp = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[f.op]
        params.push(f.value ?? null)
        conds.push(`${q} ${sqlOp} $${params.length}`)
        break
      }
    }
  }

  const term = search?.trim()
  if (term) {
    params.push(`%${term}%`)
    const idx = params.length
    const ors = meta.columns.map((c) => `${quoteIdent(c.name)}::text ILIKE $${idx}`)
    if (ors.length) conds.push(`(${ors.join(' OR ')})`)
  }

  return conds
}

export async function listRows(opts: {
  tableId: string
  limit: number
  offset: number
  filterColumn?: string | undefined
  filterValue?: unknown
  filters?: Array<FilterSpec> | undefined
  search?: string | undefined
  sort?: SortSpec | undefined
}): Promise<RowsPage> {
  const meta = await getTableMeta(opts.tableId)
  const pool = getPool()

  // Fold the legacy single-column equality filter (used by related sections)
  // into the general filter list.
  const filters: Array<FilterSpec> = [...(opts.filters ?? [])]
  if (opts.filterColumn !== undefined) {
    filters.push({
      column: opts.filterColumn,
      op: 'eq',
      value: opts.filterValue as FilterSpec['value'],
    })
  }

  const whereParams: Array<unknown> = []
  const conds = buildConditions(meta, filters, opts.search, whereParams)
  const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : ''

  // Default to ordering by the primary key so pagination is stable.
  const sortColumn = opts.sort
    ? assertColumn(meta, opts.sort.column)
    : meta.columns.find((c) => c.isPrimaryKey)?.name
  const orderBy = sortColumn
    ? ` ORDER BY ${quoteIdent(sortColumn)} ${opts.sort?.dir === 'desc' ? 'DESC' : 'ASC'}`
    : ''

  const listParams = [...whereParams, opts.limit, opts.offset]
  const sql = `SELECT * FROM ${qualifiedName(meta)}${where}${orderBy}
   LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`

  const countSql = `SELECT count(*)::int AS total FROM ${qualifiedName(meta)}${where}`

  const [rowsRes, countRes] = await Promise.all([
    pool.query(sql, listParams),
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

export { quoteIdent, splitTableId }
