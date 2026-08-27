import { queryOptions } from '@tanstack/react-query'

import { getEntityMeta, getEntityOverview, getEntityRows, listEntities } from '~/lib/functions'
import type { FilterSpec, SortSpec } from '~/lib/types'

export interface RowsQueryOpts {
  limit: number
  offset: number
  filterColumn?: string | undefined
  filterValue?: string | number | boolean | null | undefined
  filters?: Array<FilterSpec> | undefined
  sort?: SortSpec | undefined
  search?: string | undefined
}

/** Query key factory — hierarchical, serializable keys. */
export const entityKeys = {
  all: ['entities'] as const,
  list: () => [...entityKeys.all, 'list'] as const,
  meta: (table: string) => [...entityKeys.all, 'meta', table] as const,
  rows: (table: string) => [...entityKeys.all, 'rows', table] as const,
  rowsPage: (table: string, opts: RowsQueryOpts) =>
    [...entityKeys.rows(table), opts] as const,
  overview: (table: string, pkColumn: string, pkValue: string) =>
    [...entityKeys.all, 'overview', table, pkColumn, pkValue] as const,
}

export const entitiesListQuery = () =>
  queryOptions({
    queryKey: entityKeys.list(),
    queryFn: () => listEntities(),
  })

export const entityMetaQuery = (table: string) =>
  queryOptions({
    queryKey: entityKeys.meta(table),
    queryFn: () => getEntityMeta({ data: { table } }),
  })

export const entityRowsQuery = (table: string, opts: RowsQueryOpts) =>
  queryOptions({
    queryKey: entityKeys.rowsPage(table, opts),
    queryFn: () =>
      getEntityRows({
        data: {
          table,
          limit: opts.limit,
          offset: opts.offset,
          filterColumn: opts.filterColumn,
          filterValue: opts.filterValue,
          filters: opts.filters,
          sort: opts.sort,
          search: opts.search,
        },
      }),
  })

export const entityOverviewQuery = (table: string, pkColumn: string, pkValue: string) =>
  queryOptions({
    queryKey: entityKeys.overview(table, pkColumn, pkValue),
    queryFn: () => getEntityOverview({ data: { table, pkColumn, pkValue } }),
  })
