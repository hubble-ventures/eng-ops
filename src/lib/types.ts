import type { TableMeta } from '~/server/introspect'

export type { TableMeta }
export type { ColumnMeta, ForeignKeyMeta, InboundRefMeta } from '~/server/introspect'

/** A JSON-safe scalar as it crosses the server-function / hydration boundary. */
export type JsonScalar = string | number | boolean | null

/** Present but absent primary-key / FK values in generic row data. */
export type MaybeScalar = JsonScalar | undefined

/** Comparison operators supported by the list-view filter builder. */
export type FilterOp =
  | 'eq'
  | 'neq'
  | 'ilike'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'is_null'
  | 'is_not_null'

/** Operators that take no value (unary predicates). */
export const UNARY_OPS: ReadonlyArray<FilterOp> = ['is_null', 'is_not_null']

export const FILTER_OP_LABELS: Record<FilterOp, string> = {
  eq: '=',
  neq: '≠',
  ilike: 'contains',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  is_null: 'is null',
  is_not_null: 'is not null',
}

export interface FilterSpec {
  column: string
  op: FilterOp
  value?: string | number | boolean | null
}

export type SortDir = 'asc' | 'desc'

export interface SortSpec {
  column: string
  dir: SortDir
}

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
