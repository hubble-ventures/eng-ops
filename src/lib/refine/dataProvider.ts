import type { DataProvider } from '@refinedev/core'

import {
  createEntityRow,
  deleteEntityRow,
  getEntityRowByPk,
  getEntityRows,
  updateEntityRow,
} from '~/lib/functions'
import { decodeRowId } from '~/lib/refine/rowKey'
import type { JsonScalar } from '~/lib/types'

type Row = Record<string, JsonScalar>

function asRow(variables: unknown): Row {
  return (variables ?? {}) as Row
}

/**
 * Refine data provider backed by eng-ops's TanStack Start server functions.
 * Resource name = schema-qualified table id (e.g. "public.users"). Record ids
 * are the JSON-encoded primary-key map (see rowKey.ts) so composite keys work.
 */
export const dataProvider: DataProvider = {
  getApiUrl: () => '',

  getList: async ({ resource, pagination, sorters, filters }) => {
    const pageSize = pagination?.pageSize ?? 50
    const currentPage = pagination?.currentPage ?? 1
    const sort = sorters?.[0]
    // Any string-valued filter is treated as the global row search.
    const searchFilter = filters?.find(
      (f) => 'value' in f && typeof f.value === 'string' && f.value !== '',
    )

    const page = await getEntityRows({
      data: {
        table: resource,
        limit: pageSize,
        offset: (currentPage - 1) * pageSize,
        orderBy: sort?.field,
        orderDir: sort?.order,
        search:
          searchFilter && 'value' in searchFilter
            ? (searchFilter.value as string)
            : undefined,
      },
    })

    return { data: page.rows as any, total: page.total }
  },

  getOne: async ({ resource, id }) => {
    const row = await getEntityRowByPk({
      data: { table: resource, pk: decodeRowId(id) },
    })
    return { data: (row ?? {}) as any }
  },

  getMany: async ({ resource, ids }) => {
    const rows = await Promise.all(
      ids.map((id) =>
        getEntityRowByPk({ data: { table: resource, pk: decodeRowId(id) } }),
      ),
    )
    return { data: rows.filter((r): r is Row => r !== null) as any }
  },

  create: async ({ resource, variables }) => {
    const row = await createEntityRow({
      data: { table: resource, data: asRow(variables) },
    })
    return { data: row as any }
  },

  update: async ({ resource, id, variables }) => {
    const row = await updateEntityRow({
      data: {
        table: resource,
        pk: decodeRowId(id),
        patch: asRow(variables),
      },
    })
    return { data: row as any }
  },

  deleteOne: async ({ resource, id }) => {
    const row = await deleteEntityRow({
      data: { table: resource, pk: decodeRowId(id) },
    })
    return { data: row as any }
  },
}
