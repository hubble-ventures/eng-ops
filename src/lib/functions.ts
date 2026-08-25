import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import type { EntityOverview, EntitySummary, JsonScalar, RowsPage, TableMeta } from '~/lib/types'
import { introspectSchema, getTableMeta } from '~/server/introspect'
import { getRow, listRows } from '~/server/queries'

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
})

export const listEntities = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ entities: Array<EntitySummary> }> => {
    const { tables } = await introspectSchema()
    return {
      entities: tables.map((t) => ({
        id: t.id,
        name: t.name,
        schema: t.schema,
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
