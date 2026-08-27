import { z } from 'zod'

import type { ColumnMeta } from '~/lib/types'

/**
 * Type-aware column filters. A column's Postgres type decides which operators
 * are offered and what value control the UI shows — so the filter UX always
 * matches the data (a date picker for dates, a dropdown for enums, etc.).
 *
 * This module is the single source of truth shared by the filter UI
 * (TableFilters), the query layer, and the server SQL builder.
 */

export type FilterKind = 'text' | 'number' | 'date' | 'boolean' | 'enum' | 'fk'

export type FilterOp =
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'on'
  | 'before'
  | 'after'
  | 'isTrue'
  | 'isFalse'
  | 'isNull'
  | 'isNotNull'

export const FILTER_OPS: Array<FilterOp> = [
  'contains',
  'startsWith',
  'endsWith',
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'on',
  'before',
  'after',
  'isTrue',
  'isFalse',
  'isNull',
  'isNotNull',
]

export interface ColumnFilter {
  column: string
  op: FilterOp
  /** Absent for the no-value operators (isNull / isTrue / …). */
  value?: string | number | boolean | null
}

/** Operators that stand alone — they take no value input. */
export const NO_VALUE_OPS: ReadonlySet<FilterOp> = new Set<FilterOp>([
  'isTrue',
  'isFalse',
  'isNull',
  'isNotNull',
])

/** Short human labels for the operator dropdown and filter chips. */
export const OP_LABEL: Record<FilterOp, string> = {
  contains: 'contains',
  startsWith: 'starts with',
  endsWith: 'ends with',
  eq: 'is',
  neq: 'is not',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  on: 'on',
  before: 'before',
  after: 'after',
  isTrue: 'is true',
  isFalse: 'is false',
  isNull: 'is null',
  isNotNull: 'is not null',
}

const NUMBER_UDT = new Set([
  'int2',
  'int4',
  'int8',
  'numeric',
  'float4',
  'float8',
  'money',
])
// Only calendar types — the date operators compare by day (col::date), which
// Postgres cannot cast from `time`/`timetz`, so those stay text-kind.
const DATE_UDT = new Set(['date', 'timestamp', 'timestamptz'])

/** Map a column's type to a filter kind (drives operators + value control). */
export function columnKind(column: ColumnMeta, isForeignKey: boolean): FilterKind {
  if (isForeignKey) return 'fk'
  if (column.enumValues && column.enumValues.length > 0) return 'enum'
  if (column.udtName === 'bool') return 'boolean'
  if (NUMBER_UDT.has(column.udtName)) return 'number'
  if (DATE_UDT.has(column.udtName)) return 'date'
  return 'text'
}

/** Operators offered for each kind, in menu order. */
export const OPS_FOR_KIND: Record<FilterKind, Array<FilterOp>> = {
  text: ['contains', 'eq', 'neq', 'startsWith', 'endsWith', 'isNull', 'isNotNull'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'isNull', 'isNotNull'],
  date: ['on', 'before', 'after', 'isNull', 'isNotNull'],
  boolean: ['isTrue', 'isFalse', 'isNull', 'isNotNull'],
  enum: ['eq', 'neq', 'isNull', 'isNotNull'],
  fk: ['eq', 'neq', 'isNull', 'isNotNull'],
}

/** The HTML input type the value control should use for a kind. */
export function valueInputType(kind: FilterKind): 'text' | 'number' | 'date' {
  if (kind === 'number') return 'number'
  if (kind === 'date') return 'date'
  return 'text'
}

/** A filter is complete (safe to apply) when a value-taking op has a value. */
export function isFilterComplete(f: ColumnFilter): boolean {
  if (NO_VALUE_OPS.has(f.op)) return true
  return f.value !== undefined && f.value !== null && String(f.value) !== ''
}

/** Zod schema — validates filters coming from the URL and the server function. */
export const columnFilterSchema = z.object({
  column: z.string().min(1).max(200),
  op: z.enum(FILTER_OPS as [FilterOp, ...Array<FilterOp>]),
  value: z
    .union([z.string().max(500), z.number(), z.boolean(), z.null()])
    .optional(),
})
