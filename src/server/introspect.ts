import {
  columnOrderStrategy,
  tableColumnOrder,
  tableDisplayColumn,
  type ColumnOrderStrategy,
} from './config'
import { getPool } from './db'
import { env } from './env'

export interface ColumnMeta {
  name: string
  dataType: string
  udtName: string
  nullable: boolean
  isPrimaryKey: boolean
  /** identity column (GENERATED ... AS IDENTITY) — omit on insert */
  isIdentity: boolean
  /** generated column (GENERATED ALWAYS AS ...) — never writable */
  isGenerated: boolean
  /** has a column DEFAULT — safe to omit on insert */
  hasDefault: boolean
  /** the raw default expression, e.g. "true", "'member'::user_role", "nextval(...)" */
  defaultExpr: string | null
  /** varchar/char length limit, if any */
  maxLength: number | null
  /** labels for enum-typed columns, else null */
  enumValues: Array<string> | null
}

export interface ForeignKeyMeta {
  constraintName: string
  column: string
  /** schema.table of the referenced entity */
  referencedTable: string
  referencedColumn: string
}

export interface InboundRefMeta {
  /** schema.table of the entity that has the FK pointing at this table */
  fromTable: string
  fromColumn: string
  constraintName: string
}

/** What kind of relation this entity is. */
export type TableKind = 'table' | 'view' | 'materialized view' | 'foreign table'

export interface TableMeta {
  /** schema-qualified, e.g. "public.users" */
  id: string
  schema: string
  name: string
  kind: TableKind
  columns: Array<ColumnMeta>
  /** outbound FKs declared on this table */
  foreignKeys: Array<ForeignKeyMeta>
  /** inbound references from other tables */
  referencedBy: Array<InboundRefMeta>
}

let cache: { tables: Array<TableMeta> } | null = null

function tableId(schema: string, table: string) {
  return `${schema}.${table}`
}

const SYSTEM_SCHEMAS = `('pg_catalog', 'information_schema', 'pg_toast')`

// Base tables, partitioned tables, views, materialized views, foreign tables.
const REL_KINDS = ['r', 'p', 'v', 'm', 'f']

function relKindToKind(relkind: string): TableKind {
  switch (relkind) {
    case 'v':
      return 'view'
    case 'm':
      return 'materialized view'
    case 'f':
      return 'foreign table'
    default:
      return 'table' // 'r' | 'p'
  }
}

function schemaAllowlist(): Array<string> | null {
  const raw = env.PGSCHEMA?.trim()
  if (!raw) return null
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

// ---- column ordering ------------------------------------------------------

const NAME_HINTS = [
  'name',
  'title',
  'display_name',
  'label',
  'slug',
  'username',
  'email',
  'code',
]
const AUDIT_EXACT = new Set([
  'created_at',
  'updated_at',
  'deleted_at',
  'inserted_at',
  'created',
  'updated',
])

function isAudit(name: string): boolean {
  return AUDIT_EXACT.has(name) || name.endsWith('_at') || name.endsWith('_on')
}

/** Lower rank sorts earlier. */
function smartRank(col: ColumnMeta, fkCols: Set<string>): number {
  const n = col.name.toLowerCase()
  if (col.isPrimaryKey) return 0
  if (NAME_HINTS.includes(n)) return 1
  if (fkCols.has(col.name)) return 2
  if (isAudit(n)) return 4
  return 3
}

/**
 * Order a table's columns. An explicit per-table order (from config) wins;
 * otherwise the global strategy applies. "natural" keeps the database's own
 * column order; "smart" surfaces the primary key, name-like columns, and
 * foreign keys first and sinks audit timestamps to the end. Ties preserve
 * natural order, so the result is always stable.
 */
function orderColumns(
  columns: Array<ColumnMeta>,
  fkCols: Set<string>,
  strategy: ColumnOrderStrategy,
  explicit: Array<string> | undefined,
): Array<ColumnMeta> {
  if (explicit && explicit.length > 0) {
    const pos = new Map(explicit.map((n, i) => [n, i]))
    return columns
      .map((c, i) => [c, i] as const)
      .sort((a, b) => {
        const ai = pos.get(a[0].name) ?? Number.POSITIVE_INFINITY
        const bi = pos.get(b[0].name) ?? Number.POSITIVE_INFINITY
        return ai - bi || a[1] - b[1]
      })
      .map(([c]) => c)
  }
  if (strategy === 'smart') {
    return columns
      .map((c, i) => [c, i] as const)
      .sort((a, b) => {
        const ra = smartRank(a[0], fkCols)
        const rb = smartRank(b[0], fkCols)
        return ra - rb || a[1] - b[1]
      })
      .map(([c]) => c)
  }
  return columns
}

// ---- introspection --------------------------------------------------------

export async function introspectSchema(): Promise<{
  tables: Array<TableMeta>
}> {
  if (cache) return cache

  const pool = getPool()
  const allowlist = schemaAllowlist()

  // pg_catalog is used for the relation list and columns so that views,
  // materialized views and foreign tables are covered uniformly (matview
  // columns are not exposed via information_schema). Constraints (PK/FK)
  // come from information_schema and simply return nothing for non-tables.
  const relWhere = allowlist
    ? `c.relkind = ANY($1) AND n.nspname = ANY($2)`
    : `c.relkind = ANY($1) AND n.nspname NOT IN ${SYSTEM_SCHEMAS}
         AND n.nspname NOT LIKE 'pg_temp%'`
  const relParams = allowlist ? [REL_KINDS, allowlist] : [REL_KINDS]

  const fkSchemaFilter = allowlist
    ? `AND kcu.table_schema = ANY($1)`
    : `AND kcu.table_schema NOT IN ${SYSTEM_SCHEMAS}`
  const constraintParams = allowlist ? [allowlist] : []

  const relRes = await pool.query<{
    table_schema: string
    table_name: string
    relkind: string
  }>(
    `SELECT n.nspname AS table_schema, c.relname AS table_name, c.relkind
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${relWhere}
      ORDER BY n.nspname, c.relname`,
    relParams,
  )

  const columnsRes = await pool.query<{
    table_schema: string
    table_name: string
    column_name: string
    data_type: string
    udt_name: string
    is_nullable: boolean
    is_identity: boolean
    is_generated: boolean
    has_default: boolean
    default_expr: string | null
    max_length: number | null
    type_oid: number
    is_enum: boolean
  }>(
    `SELECT n.nspname AS table_schema,
            c.relname AS table_name,
            a.attname AS column_name,
            format_type(a.atttypid, a.atttypmod) AS data_type,
            t.typname AS udt_name,
            NOT a.attnotnull AS is_nullable,
            a.attidentity <> '' AS is_identity,
            a.attgenerated <> '' AS is_generated,
            a.atthasdef AS has_default,
            pg_get_expr(ad.adbin, ad.adrelid) AS default_expr,
            CASE WHEN t.typname IN ('varchar', 'bpchar') AND a.atttypmod > 4
                 THEN a.atttypmod - 4 END AS max_length,
            a.atttypid AS type_oid,
            t.typtype = 'e' AS is_enum
       FROM pg_attribute a
       JOIN pg_class c ON c.oid = a.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_type t ON t.oid = a.atttypid
       LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      WHERE a.attnum > 0
        AND NOT a.attisdropped
        AND ${relWhere}
      ORDER BY n.nspname, c.relname, a.attnum`,
    relParams,
  )

  // Enum labels, keyed by type oid, so enum columns can offer a value list.
  const enumRes = await pool.query<{ enumtypid: number; enumlabel: string }>(
    `SELECT enumtypid, enumlabel FROM pg_enum ORDER BY enumtypid, enumsortorder`,
  )
  const enumsByType = new Map<number, Array<string>>()
  for (const e of enumRes.rows) {
    const list = enumsByType.get(e.enumtypid) ?? []
    list.push(e.enumlabel)
    enumsByType.set(e.enumtypid, list)
  }

  const pkRes = await pool.query<{
    table_schema: string
    table_name: string
    column_name: string
  }>(
    `SELECT kcu.table_schema, kcu.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.constraint_schema = kcu.constraint_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        ${fkSchemaFilter}`,
    constraintParams,
  )

  const fkRes = await pool.query<{
    constraint_name: string
    table_schema: string
    table_name: string
    column_name: string
    foreign_table_schema: string
    foreign_table_name: string
    foreign_column_name: string
  }>(
    `SELECT
        tc.constraint_name,
        kcu.table_schema,
        kcu.table_name,
        kcu.column_name,
        ccu.table_schema  AS foreign_table_schema,
        ccu.table_name    AS foreign_table_name,
        ccu.column_name   AS foreign_column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.constraint_schema = kcu.constraint_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        ${fkSchemaFilter}
      ORDER BY kcu.table_schema, kcu.table_name, kcu.column_name`,
    constraintParams,
  )

  const pkSet = new Set(
    pkRes.rows.map((r) => tableId(r.table_schema, r.table_name) + '.' + r.column_name),
  )

  const tables = new Map<string, TableMeta>()
  for (const t of relRes.rows) {
    const id = tableId(t.table_schema, t.table_name)
    tables.set(id, {
      id,
      schema: t.table_schema,
      name: t.table_name,
      kind: relKindToKind(t.relkind),
      columns: [],
      foreignKeys: [],
      referencedBy: [],
    })
  }

  for (const c of columnsRes.rows) {
    const id = tableId(c.table_schema, c.table_name)
    const table = tables.get(id)
    if (!table) continue
    table.columns.push({
      name: c.column_name,
      dataType: c.data_type,
      udtName: c.udt_name,
      nullable: c.is_nullable,
      isPrimaryKey: pkSet.has(`${id}.${c.column_name}`),
      isIdentity: c.is_identity,
      isGenerated: c.is_generated,
      hasDefault: c.has_default,
      defaultExpr: c.default_expr,
      maxLength: c.max_length,
      enumValues: c.is_enum ? (enumsByType.get(c.type_oid) ?? null) : null,
    })
  }

  for (const fk of fkRes.rows) {
    const fromId = tableId(fk.table_schema, fk.table_name)
    const toId = tableId(fk.foreign_table_schema, fk.foreign_table_name)
    const from = tables.get(fromId)
    const to = tables.get(toId)
    if (from) {
      from.foreignKeys.push({
        constraintName: fk.constraint_name,
        column: fk.column_name,
        referencedTable: toId,
        referencedColumn: fk.foreign_column_name,
      })
    }
    if (to) {
      to.referencedBy.push({
        fromTable: fromId,
        fromColumn: fk.column_name,
        constraintName: fk.constraint_name,
      })
    }
  }

  // Apply column ordering once, after PKs and FKs are known.
  const strategy = columnOrderStrategy()
  for (const table of tables.values()) {
    const fkCols = new Set(table.foreignKeys.map((f) => f.column))
    table.columns = orderColumns(
      table.columns,
      fkCols,
      strategy,
      tableColumnOrder(table.id),
    )
  }

  cache = { tables: [...tables.values()] }
  return cache
}

export async function getTableMeta(tableIdParam: string): Promise<TableMeta> {
  const { tables } = await introspectSchema()
  const meta = tables.find((t) => t.id === tableIdParam || t.name === tableIdParam)
  if (!meta) {
    throw new Error(`Unknown entity: ${tableIdParam}`)
  }
  return meta
}

export async function listTableIds(): Promise<Array<string>> {
  const { tables } = await introspectSchema()
  return tables.map((t) => t.id)
}

/** Primary-key column names for a table, in column order (may be empty). */
export function primaryKeyColumns(meta: TableMeta): Array<string> {
  return meta.columns.filter((c) => c.isPrimaryKey).map((c) => c.name)
}

const LABEL_HINTS = [
  'name',
  'title',
  'label',
  'display_name',
  'full_name',
  'email',
  'slug',
  'username',
  'code',
]

/**
 * Best column to represent a row as a human label when referenced by a FK:
 * the configured displayColumn, else a name-like column, else the first text
 * column, else the primary key.
 */
export function pickDisplayColumn(meta: TableMeta): string {
  const configured = tableDisplayColumn(meta.id)
  if (configured && meta.columns.some((c) => c.name === configured)) {
    return configured
  }
  for (const hint of LABEL_HINTS) {
    const hit = meta.columns.find((c) => c.name.toLowerCase() === hint)
    if (hit) return hit.name
  }
  const text = meta.columns.find(
    (c) =>
      !c.isPrimaryKey &&
      (c.udtName === 'text' || c.udtName === 'varchar' || c.udtName === 'citext'),
  )
  if (text) return text.name
  const pk = meta.columns.find((c) => c.isPrimaryKey)
  return pk?.name ?? meta.columns[0]?.name ?? 'id'
}
