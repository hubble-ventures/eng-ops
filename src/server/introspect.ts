import {
  columnOrderStrategy,
  tableColumnOrder,
  tableDisplayColumn,
  type ColumnOrderStrategy,
} from './config'
import type { Pool } from 'pg'

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

/** ON DELETE action of a foreign key, as pg_constraint.confdeltype spells it. */
export type FkAction = 'no action' | 'restrict' | 'cascade' | 'set null' | 'set default'

export interface ForeignKeyMeta {
  constraintName: string
  /** first constrained column — the whole key is in {@link columns} */
  column: string
  /** every constrained column, in key order (length > 1 for a composite FK) */
  columns: Array<string>
  /** schema.table of the referenced entity */
  referencedTable: string
  /** first referenced column — the whole key is in {@link referencedColumns} */
  referencedColumn: string
  /** every referenced column, in the same order as {@link columns} */
  referencedColumns: Array<string>
  onDelete: FkAction
}

export interface InboundRefMeta {
  /** schema.table of the entity that has the FK pointing at this table */
  fromTable: string
  /** first constrained column — the whole key is in {@link fromColumns} */
  fromColumn: string
  /** every constrained column on the referencing table, in key order */
  fromColumns: Array<string>
  /** the columns of *this* table the FK points at, in the same order */
  toColumns: Array<string>
  constraintName: string
  onDelete: FkAction
}

/**
 * A unique index, as the merge engine needs to read it.
 *
 * `columns` holds key columns only — an index's INCLUDE payload does not
 * participate in uniqueness, so it must not be treated as part of the scope.
 */
export interface UniqueIndexMeta {
  name: string
  /** key column names, in index order; empty for a pure expression index */
  columns: Array<string>
  /** `pg_get_expr(indpred, indrelid)` for a partial index, else null */
  predicate: string | null
  /**
   * NULLS NOT DISTINCT (PG15+). Postgres treats NULLs as distinct by default,
   * so equality against this index is `=` unless this is set.
   */
  nullsNotDistinct: boolean
  /** the key includes an expression (indkey contains 0) — not comparable by column */
  hasExpressions: boolean
  isPrimary: boolean
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
  /** unique indexes (including the primary key's) on this relation */
  uniqueIndexes: Array<UniqueIndexMeta>
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

function fkAction(confdeltype: string): FkAction {
  switch (confdeltype) {
    case 'c':
      return 'cascade'
    case 'n':
      return 'set null'
    case 'd':
      return 'set default'
    case 'r':
      return 'restrict'
    default:
      return 'no action'
  }
}

interface UniqueIndexRow {
  table_schema: string
  table_name: string
  index_name: string
  columns: Array<string> | null
  predicate: string | null
  nulls_not_distinct: boolean
  has_expressions: boolean
  is_primary: boolean
}

/**
 * Unique indexes for every introspected relation.
 *
 * Only the first `indnkeyatts` entries of `indkey` are key columns; anything
 * after them is an INCLUDE payload that plays no part in uniqueness. A 0 in the
 * key means an expression, which cannot be compared column-by-column — callers
 * are expected to refuse rather than merge past a rule they cannot evaluate.
 *
 * `indnullsnotdistinct` only exists from PG15, so it is probed and defaulted to
 * false on older servers (where NULLs are always distinct anyway).
 */
async function queryUniqueIndexes(
  pool: Pool,
  relWhere: string,
  relParams: Array<unknown>,
): Promise<Array<UniqueIndexRow>> {
  const versionRes = await pool.query<{ v: string }>(
    `SELECT current_setting('server_version_num') AS v`,
  )
  const supportsNullsNotDistinct = Number(versionRes.rows[0]?.v ?? '0') >= 150000
  const nullsNotDistinct = supportsNullsNotDistinct
    ? 'i.indnullsnotdistinct'
    : 'false'

  const res = await pool.query<UniqueIndexRow>(
    `SELECT n.nspname  AS table_schema,
            c.relname  AS table_name,
            ic.relname AS index_name,
            i.indisprimary AS is_primary,
            ${nullsNotDistinct} AS nulls_not_distinct,
            pg_get_expr(i.indpred, i.indrelid) AS predicate,
            EXISTS (
              SELECT 1 FROM unnest(i.indkey::int[]) WITH ORDINALITY AS k(attnum, ord)
               WHERE k.ord <= i.indnkeyatts AND k.attnum = 0
            ) AS has_expressions,
            (SELECT array_agg(a.attname::text ORDER BY k.ord)
               FROM unnest(i.indkey::int[]) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a
                 ON a.attrelid = i.indrelid AND a.attnum = k.attnum
              WHERE k.ord <= i.indnkeyatts) AS columns
       FROM pg_index i
       JOIN pg_class ic ON ic.oid = i.indexrelid
       JOIN pg_class c  ON c.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE i.indisunique
        AND i.indislive
        AND ${relWhere}
      ORDER BY n.nspname, c.relname, ic.relname`,
    relParams,
  )
  return res.rows
}

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

  // Foreign keys come from pg_catalog rather than information_schema: joining
  // key_column_usage to constraint_column_usage pairs every constrained column
  // with every referenced one, which is a cross product for a composite key.
  // unnest(...) WITH ORDINALITY keeps the two sides aligned. The ::text casts
  // matter — array_agg over `name` yields name[], which the driver cannot parse
  // and hands back as the raw string "{a,b}".
  const fkWhere = allowlist
    ? `n.nspname = ANY($1) AND fn.nspname = ANY($1)`
    : `n.nspname NOT IN ${SYSTEM_SCHEMAS} AND fn.nspname NOT IN ${SYSTEM_SCHEMAS}`

  const fkRes = await pool.query<{
    constraint_name: string
    table_schema: string
    table_name: string
    columns: Array<string>
    foreign_table_schema: string
    foreign_table_name: string
    ref_columns: Array<string>
    on_delete: string
  }>(
    `SELECT con.conname                AS constraint_name,
            n.nspname                  AS table_schema,
            c.relname                  AS table_name,
            fn.nspname                 AS foreign_table_schema,
            fc.relname                 AS foreign_table_name,
            con.confdeltype            AS on_delete,
            (SELECT array_agg(a.attname::text ORDER BY k.ord)
               FROM unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a
                 ON a.attrelid = con.conrelid AND a.attnum = k.attnum) AS columns,
            (SELECT array_agg(a.attname::text ORDER BY k.ord)
               FROM unnest(con.confkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a
                 ON a.attrelid = con.confrelid AND a.attnum = k.attnum) AS ref_columns
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_class fc ON fc.oid = con.confrelid
       JOIN pg_namespace fn ON fn.oid = fc.relnamespace
      WHERE con.contype = 'f'
        AND ${fkWhere}
      ORDER BY n.nspname, c.relname, con.conname`,
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
      uniqueIndexes: [],
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
    const columns = fk.columns ?? []
    const refColumns = fk.ref_columns ?? []
    if (columns.length === 0 || refColumns.length !== columns.length) continue
    const onDelete = fkAction(fk.on_delete)
    if (from) {
      from.foreignKeys.push({
        constraintName: fk.constraint_name,
        column: columns[0]!,
        columns,
        referencedTable: toId,
        referencedColumn: refColumns[0]!,
        referencedColumns: refColumns,
        onDelete,
      })
    }
    if (to) {
      to.referencedBy.push({
        fromTable: fromId,
        fromColumn: columns[0]!,
        fromColumns: columns,
        toColumns: refColumns,
        constraintName: fk.constraint_name,
        onDelete,
      })
    }
  }

  for (const idx of await queryUniqueIndexes(pool, relWhere, relParams)) {
    tables.get(tableId(idx.table_schema, idx.table_name))?.uniqueIndexes.push({
      name: idx.index_name,
      columns: idx.columns ?? [],
      predicate: idx.predicate,
      nullsNotDistinct: idx.nulls_not_distinct,
      hasExpressions: idx.has_expressions,
      isPrimary: idx.is_primary,
    })
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
