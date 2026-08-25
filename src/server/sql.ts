/**
 * Pure SQL builders for write operations. Kept dependency-free (no pool, no
 * introspection) so they can be unit-tested against a throwaway table.
 * Every identifier is quoted; every value is a bind parameter.
 */

export interface SqlQuery {
  text: string
  values: Array<unknown>
}

export interface ColumnValue {
  column: string
  value: unknown
}

export function quoteIdent(ident: string): string {
  return '"' + ident.replaceAll('"', '""') + '"'
}

/** `"schema"."table"` from raw (unquoted) parts. */
export function qualifiedName(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`
}

export function buildInsert(
  qname: string,
  entries: Array<ColumnValue>,
): SqlQuery {
  if (entries.length === 0) {
    return { text: `INSERT INTO ${qname} DEFAULT VALUES RETURNING *`, values: [] }
  }
  const cols = entries.map((e) => quoteIdent(e.column)).join(', ')
  const placeholders = entries.map((_, i) => `$${i + 1}`).join(', ')
  return {
    text: `INSERT INTO ${qname} (${cols}) VALUES (${placeholders}) RETURNING *`,
    values: entries.map((e) => e.value),
  }
}

export function buildUpdate(
  qname: string,
  setEntries: Array<ColumnValue>,
  pkEntries: Array<ColumnValue>,
): SqlQuery {
  if (setEntries.length === 0) throw new Error('UPDATE requires at least one column')
  if (pkEntries.length === 0) throw new Error('UPDATE requires a primary key')
  const values: Array<unknown> = []
  const setSql = setEntries
    .map((e) => {
      values.push(e.value)
      return `${quoteIdent(e.column)} = $${values.length}`
    })
    .join(', ')
  const whereSql = pkEntries
    .map((e) => {
      values.push(e.value)
      return `${quoteIdent(e.column)} = $${values.length}`
    })
    .join(' AND ')
  return {
    text: `UPDATE ${qname} SET ${setSql} WHERE ${whereSql} RETURNING *`,
    values,
  }
}

export function buildDelete(
  qname: string,
  pkEntries: Array<ColumnValue>,
): SqlQuery {
  if (pkEntries.length === 0) throw new Error('DELETE requires a primary key')
  const values: Array<unknown> = []
  const whereSql = pkEntries
    .map((e) => {
      values.push(e.value)
      return `${quoteIdent(e.column)} = $${values.length}`
    })
    .join(' AND ')
  return { text: `DELETE FROM ${qname} WHERE ${whereSql} RETURNING *`, values }
}
