import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { columnFilterSchema } from '~/lib/filters'
import type { EntityOverview, EntitySummary, JsonScalar, RowsPage, TableMeta } from '~/lib/types'
import { env } from '~/server/env'
import { introspectSchema, getTableMeta } from '~/server/introspect'
import { mergeRows, previewMerge, type MergePlan, type MergeResult } from '~/server/merge'
import {
  createRow,
  deleteRow,
  getRow,
  getRowLabels,
  listRows,
  updateRow,
} from '~/server/queries'

const tableIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)?$/, 'invalid table id')

const rowsInput = z.object({
  table: tableIdSchema,
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  filterColumn: z.string().min(1).max(200).optional(),
  filterValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  /** Type-aware per-column filters (see ~/lib/filters). */
  filters: z.array(columnFilterSchema).max(20).optional(),
  orderBy: z.string().min(1).max(200).optional(),
  orderDir: z.enum(['asc', 'desc']).optional(),
  search: z.string().max(500).optional(),
})

export const listEntities = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{
    entities: Array<EntitySummary>
    writeEnabled: boolean
  }> => {
    const { tables } = await introspectSchema()
    return {
      writeEnabled: env.ENGOPS_WRITE,
      entities: tables.map((t) => ({
        id: t.id,
        name: t.name,
        schema: t.schema,
        kind: t.kind,
        columnCount: t.columns.length,
        outboundFkCount: t.foreignKeys.length,
        inboundRefCount: t.referencedBy.length,
      })),
    }
  },
)

export const getEntityMeta = createServerFn({ method: 'GET' })
  .validator(z.object({ table: tableIdSchema }))
  .handler(async ({ data }): Promise<TableMeta> => {
    return await getTableMeta(data.table)
  })

export const getEntityRows = createServerFn({ method: 'GET' })
  .validator(rowsInput)
  .handler(async ({ data }): Promise<RowsPage> => {
    return await listRows({
      tableId: data.table,
      limit: data.limit,
      offset: data.offset,
      filterColumn: data.filterColumn,
      filterValue: data.filterValue,
      filters: data.filters,
      orderBy: data.orderBy,
      orderDir: data.orderDir,
      search: data.search,
    })
  })

export const getEntityOverview = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      table: tableIdSchema,
      pkColumn: z.string().min(1).max(200),
      pkValue: z.union([z.string(), z.number()]),
    }),
  )
  .handler(async ({ data }): Promise<EntityOverview> => {
    const meta = await getTableMeta(data.table)
    const row = await getRow({
      tableId: data.table,
      pkColumn: data.pkColumn,
      pkValue: data.pkValue,
    })
    if (!row) {
      throw new Error(
        `No row in ${data.table} where ${data.pkColumn} = ${String(data.pkValue)}`,
      )
    }

    const links = meta.foreignKeys
      .map((fk) => ({ fk, value: row[fk.column] }))
      .filter(
        (x): x is { fk: (typeof meta.foreignKeys)[number]; value: JsonScalar } =>
          x.value !== null && x.value !== undefined,
      )
      .map(({ fk, value }) => ({
        column: fk.column,
        value,
        referencedTable: fk.referencedTable,
        referencedColumn: fk.referencedColumn,
      }))

    return {
      table: meta,
      row,
      pkColumn: data.pkColumn,
      pkValue: String(data.pkValue),
      links,
      related: meta.referencedBy.map((r) => ({
        fromTable: r.fromTable,
        fromColumn: r.fromColumn,
        constraintName: r.constraintName,
      })),
    }
  })

// ---- writes (gated by ENGOPS_WRITE) --------------------------------------

const jsonScalar = z.union([z.string(), z.number(), z.boolean(), z.null()])
const rowData = z.record(z.string().min(1).max(200), jsonScalar)

export interface LabelResult {
  table: string
  column: string
  entries: Array<{ value: JsonScalar; label: string }>
}

export const getEntityLabels = createServerFn({ method: 'GET' })
  .validator(
    z.object({
      requests: z
        .array(
          z.object({
            table: tableIdSchema,
            column: z.string().min(1).max(200),
            values: z.array(jsonScalar).max(500),
          }),
        )
        .max(20),
    }),
  )
  .handler(async ({ data }): Promise<{ results: Array<LabelResult> }> => {
    const results: Array<LabelResult> = []
    for (const r of data.requests) {
      results.push({
        table: r.table,
        column: r.column,
        entries: await getRowLabels({
          tableId: r.table,
          column: r.column,
          values: r.values,
        }),
      })
    }
    return { results }
  })

export const createEntityRow = createServerFn({ method: 'POST' })
  .validator(z.object({ table: tableIdSchema, data: rowData }))
  .handler(async ({ data }): Promise<Record<string, JsonScalar>> => {
    return await createRow({ tableId: data.table, data: data.data })
  })

export const updateEntityRow = createServerFn({ method: 'POST' })
  .validator(z.object({ table: tableIdSchema, pk: rowData, patch: rowData }))
  .handler(async ({ data }): Promise<Record<string, JsonScalar>> => {
    return await updateRow({ tableId: data.table, pk: data.pk, patch: data.patch })
  })

export const deleteEntityRow = createServerFn({ method: 'POST' })
  .validator(z.object({ table: tableIdSchema, pk: rowData }))
  .handler(async ({ data }): Promise<Record<string, JsonScalar>> => {
    return await deleteRow({ tableId: data.table, pk: data.pk })
  })

// ---- merge (gated by ENGOPS_WRITE) ---------------------------------------

const mergeInput = z.object({
  table: tableIdSchema,
  /** primary-key value of the row that survives */
  keeperPk: z.string().min(1).max(500),
  /** primary-key value of the row that is merged away */
  loserPk: z.string().min(1).max(500),
})

/**
 * Merging is a write, and a destructive one, so both the preview and the
 * execution are behind the same flag as create/update/delete. A read-only
 * deployment does not offer the feature at all.
 */
function assertMergeEnabled(): void {
  if (!env.ENGOPS_WRITE) {
    throw new Error(
      'Merging is disabled. Set ENGOPS_WRITE=1 (and use a role with write privileges) to enable it.',
    )
  }
}

export const getMergePlan = createServerFn({ method: 'GET' })
  .validator(mergeInput)
  .handler(async ({ data }): Promise<MergePlan> => {
    assertMergeEnabled()
    return await previewMerge(data.table, data.keeperPk, data.loserPk)
  })

export const mergeEntityRows = createServerFn({ method: 'POST' })
  .validator(
    mergeInput.extend({
      /** the signature of the plan the operator actually confirmed */
      signature: z.string().min(1).max(200_000),
    }),
  )
  .handler(async ({ data }): Promise<MergeResult> => {
    assertMergeEnabled()
    return await mergeRows({
      tableId: data.table,
      keeperPk: data.keeperPk,
      loserPk: data.loserPk,
      expectedSignature: data.signature,
    })
  })
