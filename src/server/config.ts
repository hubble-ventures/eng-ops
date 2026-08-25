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
const configSchema = z.object({
  /** Default ordering strategy when a table has no explicit order. */
  columnOrder: z.enum(['natural', 'smart']).optional(),
  /** Per-table overrides, keyed by schema-qualified id (e.g. "public.users"). */
  tables: z
    .record(
      z.string(),
      z.object({
        /** Column names to pin first, in this order; the rest follow. */
        columnOrder: z.array(z.string()).optional(),
        /** Column to show as this row's human label when referenced by a FK. */
        displayColumn: z.string().optional(),
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
