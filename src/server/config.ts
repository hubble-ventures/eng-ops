import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { z } from 'zod'

import { env } from './env'

export type ColumnOrderStrategy = 'natural' | 'smart'

/**
 * Optional deployment config, loaded from ENGOPS_CONFIG (or ./engops.config.json).
 * Lets an operator override the global column-ordering strategy and pin an
 * explicit column order per table without touching code.
 */
/**
 * An extra reference edge the catalog cannot see.
 *
 * A merge can only reassign references it can discover, and `pg_constraint`
 * only knows about declared foreign keys. Polymorphic associations (`owner_id`
 * paired with `owner_type`) cannot have one by construction, and plenty of
 * plain columns simply never got a constraint. Both are invisible to
 * introspection, so an operator declares them here.
 *
 * `guard` is raw SQL appended to the edge's WHERE clause (`owner_type =
 * 'user'`). It is operator-supplied config, trusted at the same level as
 * DATABASE_URL — it is not, and cannot be, validated as safe input.
 */
const extraEdgeSchema = z.object({
  /** schema-qualified table holding the reference, e.g. "public.audit_log" */
  table: z.string().min(1),
  /** the column holding the referenced id */
  column: z.string().min(1),
  /** optional SQL predicate narrowing the edge (the polymorphic case) */
  guard: z.string().min(1).nullish(),
})

export type ExtraEdgeConfig = z.infer<typeof extraEdgeSchema>

const tableMergeSchema = z.object({
  /** Reference edges into this table that have no foreign key to find. */
  extraEdges: z.array(extraEdgeSchema).optional(),
  /** Column to stamp instead of deleting the merged-away row. */
  tombstoneColumn: z.string().optional(),
  /** Columns that don't count as information when comparing colliding rows. */
  ignoredColumns: z.array(z.string()).optional(),
})

const mergeSchema = z.object({
  /**
   * Columns ignored when deciding whether two colliding rows say the same
   * thing. Primary-key, identity and generated columns are excluded from the
   * comparison already (introspection knows them); this list is for the
   * bookkeeping columns only a human can recognise.
   */
  ignoredColumns: z.array(z.string()).optional(),
  /**
   * Candidate soft-delete columns, tried in order. The first one a table
   * actually has is stamped instead of deleting the merged-away row.
   */
  tombstoneColumns: z.array(z.string()).optional(),
  /** Warn in the plan when a single reassignment would touch more rows than this. */
  moveWarningThreshold: z.number().int().positive().optional(),
})

const configSchema = z.object({
  /** Default ordering strategy when a table has no explicit order. */
  columnOrder: z.enum(['natural', 'smart']).optional(),
  /** Defaults for the row-merge engine (see ~/server/merge). */
  merge: mergeSchema.optional(),
  /** Per-table overrides, keyed by schema-qualified id (e.g. "public.users"). */
  tables: z
    .record(
      z.string(),
      z.object({
        /** Column names to pin first, in this order; the rest follow. */
        columnOrder: z.array(z.string()).optional(),
        /** Column to show as this row's human label when referenced by a FK. */
        displayColumn: z.string().optional(),
        /** Per-table merge settings. */
        merge: tableMergeSchema.optional(),
      }),
    )
    .optional(),
})

export type AppConfig = z.infer<typeof configSchema>

let cache: AppConfig | null = null

function loadConfig(): AppConfig {
  if (cache) return cache

  const path = resolve(process.cwd(), env.ENGOPS_CONFIG ?? 'engops.config.json')
  let raw: unknown = {}
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // No config file (or unreadable) — fall back to defaults. Only the
    // explicitly-set ENGOPS_CONFIG being missing is worth surfacing.
    if (env.ENGOPS_CONFIG) {
      console.warn(`[eng-ops] ENGOPS_CONFIG set but ${path} could not be read`)
    }
  }

  const parsed = configSchema.safeParse(raw)
  if (!parsed.success) {
    console.warn('[eng-ops] ignoring invalid eng-ops config:', z.treeifyError(parsed.error))
    cache = {}
  } else {
    cache = parsed.data
  }
  return cache
}

/** Global strategy: env var wins, then config file, then "natural". */
export function columnOrderStrategy(): ColumnOrderStrategy {
  return env.ENGOPS_COLUMN_ORDER ?? loadConfig().columnOrder ?? 'natural'
}

/** Explicit per-table column order, if the deployment pinned one. */
export function tableColumnOrder(tableId: string): Array<string> | undefined {
  return loadConfig().tables?.[tableId]?.columnOrder
}

/** Configured display column for a table's FK labels, if any. */
export function tableDisplayColumn(tableId: string): string | undefined {
  return loadConfig().tables?.[tableId]?.displayColumn
}

// ---- merge ----------------------------------------------------------------

const DEFAULT_IGNORED_COLUMNS = ['created_at', 'updated_at']
const DEFAULT_TOMBSTONE_COLUMNS = ['deleted_at', 'archived_at', 'discarded_at']
const DEFAULT_MOVE_WARNING_THRESHOLD = 10_000

/** Undiscoverable reference edges into a table, declared by the operator. */
export function tableExtraEdges(tableId: string): Array<ExtraEdgeConfig> {
  return loadConfig().tables?.[tableId]?.merge?.extraEdges ?? []
}

/**
 * Columns that carry no information when comparing two colliding rows.
 * A per-table list replaces the global one rather than adding to it, so a
 * table with unusual bookkeeping can opt out of the defaults entirely.
 */
export function mergeIgnoredColumns(tableId: string): Array<string> {
  const config = loadConfig()
  return (
    config.tables?.[tableId]?.merge?.ignoredColumns ??
    config.merge?.ignoredColumns ??
    DEFAULT_IGNORED_COLUMNS
  )
}

/** Soft-delete column candidates for a table, most specific first. */
export function mergeTombstoneColumns(tableId: string): Array<string> {
  const config = loadConfig()
  const explicit = config.tables?.[tableId]?.merge?.tombstoneColumn
  if (explicit) return [explicit]
  return config.merge?.tombstoneColumns ?? DEFAULT_TOMBSTONE_COLUMNS
}

/** Row count above which a single reassignment is worth flagging. */
export function mergeMoveWarningThreshold(): number {
  return loadConfig().merge?.moveWarningThreshold ?? DEFAULT_MOVE_WARNING_THRESHOLD
}
