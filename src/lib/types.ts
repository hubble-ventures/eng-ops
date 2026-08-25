import type { TableMeta } from '~/server/introspect'

export type { TableMeta }
export type { ColumnMeta, ForeignKeyMeta, InboundRefMeta } from '~/server/introspect'

/** A JSON-safe scalar as it crosses the server-function / hydration boundary. */
export type JsonScalar = string | number | boolean | null

/** Present but absent primary-key / FK values in generic row data. */
export type MaybeScalar = JsonScalar | undefined

export interface RowsPage {
  rows: Array<Record<string, JsonScalar>>
  total: number
  limit: number
  offset: number
}

export interface EntitySummary {
  /** schema-qualified id, e.g. "public.users" */
  id: string
  name: string
  schema: string
  columnCount: number
  outboundFkCount: number
  inboundRefCount: number
}

export interface EntityOverview {
  table: TableMeta
  row: Record<string, JsonScalar>
  pkColumn: string
  pkValue: string
  /** outbound FK values resolved to link targets */
  links: Array<{
    column: string
    value: JsonScalar
    referencedTable: string
    referencedColumn: string
  }>
  /** inbound reference sections (rows loaded client-side via query) */
  related: Array<{
    fromTable: string
    fromColumn: string
    constraintName: string
  }>
}
