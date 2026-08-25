import { env } from './env'
import { getPool } from './db'

export interface ColumnMeta {
  name: string
  dataType: string
  udtName: string
  nullable: boolean
  isPrimaryKey: boolean
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

export interface TableMeta {
  /** schema-qualified, e.g. "public.users" */
  id: string
  schema: string
  name: string
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

function schemaAllowlist(): Array<string> | null {
  const raw = env.PGSCHEMA?.trim()
  if (!raw) return null
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export async function introspectSchema(): Promise<{
  tables: Array<TableMeta>
}> {
  if (cache) return cache

  const pool = getPool()
  const allowlist = schemaAllowlist()
  // Parameterized allowlist when present; otherwise all non-system schemas.
  const schemaFilter = allowlist
    ? `AND table_schema = ANY($1)`
    : `AND table_schema NOT IN ${SYSTEM_SCHEMAS}`
  const fkSchemaFilter = allowlist
    ? `AND kcu.table_schema = ANY($1)`
    : `AND kcu.table_schema NOT IN ${SYSTEM_SCHEMAS}`
  const params = allowlist ? [allowlist] : []

  const tablesRes = await pool.query<{
    table_schema: string
    table_name: string
  }>(
    `SELECT table_schema, table_name
       FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
      ${schemaFilter}
      ORDER BY table_schema, table_name`,
    params,
  )

  const columnsRes = await pool.query<{
    table_schema: string
    table_name: string
    column_name: string
    data_type: string
    udt_name: string
    is_nullable: 'YES' | 'NO'
  }>(
    `SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns
      WHERE true ${schemaFilter}
      ORDER BY table_schema, table_name, ordinal_position`,
    params,
  )

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
    params,
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
    params,
  )

  const pkSet = new Set(
    pkRes.rows.map((r) => tableId(r.table_schema, r.table_name) + '.' + r.column_name),
  )

  const tables = new Map<string, TableMeta>()
  for (const t of tablesRes.rows) {
    const id = tableId(t.table_schema, t.table_name)
    tables.set(id, {
      id,
      schema: t.table_schema,
      name: t.table_name,
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
      nullable: c.is_nullable === 'YES',
      isPrimaryKey: pkSet.has(`${id}.${c.column_name}`),
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
