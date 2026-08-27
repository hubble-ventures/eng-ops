import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import type { SortingState } from '@tanstack/react-table'
import { z } from 'zod'

import * as React from 'react'

import { DataTable } from '~/components/DataTable'
import { CreateRowButton } from '~/components/RecordDialogs'
import { Badge } from '~/components/ui/badge'
import { Skeleton } from '~/components/ui/skeleton'
import { columnFilterSchema, type ColumnFilter } from '~/lib/filters'
import {
  buildLabelLookup,
  buildLabelRequests,
  entitiesListQuery,
  entityLabelsQuery,
  entityMetaQuery,
  entityRowsQuery,
} from '~/lib/queries'

const searchSchema = z.object({
  page: z.number().int().min(1).catch(1),
  pageSize: z.number().int().min(1).max(200).catch(50),
  sort: z.string().optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  q: z.string().optional(),
  filters: z.array(columnFilterSchema).catch([]).optional(),
})

export const Route = createFileRoute('/entities/$table/')({
  validateSearch: searchSchema,
  beforeLoad: ({ params }) => ({ crumb: params.table }),
  loaderDeps: ({ search }) => ({
    page: search.page,
    pageSize: search.pageSize,
    sort: search.sort,
    dir: search.dir,
    q: search.q,
    filters: search.filters,
  }),
  loader: async ({ params, context, deps }) => {
    const meta = await context.queryClient.ensureQueryData(
      entityMetaQuery(params.table),
    )
    await context.queryClient.ensureQueryData(
      entityRowsQuery(params.table, {
        limit: deps.pageSize,
        offset: (deps.page - 1) * deps.pageSize,
        orderBy: deps.sort,
        orderDir: deps.dir,
        search: deps.q,
        filters: deps.filters,
      }),
    )
    return { meta }
  },
  component: EntityListPage,
})

function EntityListPage() {
  const { table } = Route.useParams()
  const { page, pageSize, sort, dir, q, filters } = Route.useSearch()
  const { meta } = Route.useLoaderData()
  const navigate = Route.useNavigate()

  const activeFilters = filters ?? []

  const rowsQuery = useQuery(
    entityRowsQuery(table, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      orderBy: sort,
      orderDir: dir,
      search: q,
      // Pass the raw search value (not the []-normalized activeFilters) so the
      // query key matches the loader's ensureQueryData key when no filters are
      // set — otherwise the SSR prefetch is a cache miss and refetches.
      filters,
    }),
  )
  const rowsPage = rowsQuery.data
  const writeEnabled = useQuery(entitiesListQuery()).data?.writeEnabled ?? false

  // Resolve FK values on this page to human labels.
  const labelRequests = React.useMemo(
    () =>
      rowsPage
        ? buildLabelRequests(meta.foreignKeys, rowsPage.rows)
        : [],
    [meta.foreignKeys, rowsPage],
  )
  const labelsQuery = useQuery(entityLabelsQuery(labelRequests))
  const fkLabels = React.useMemo(
    () => buildLabelLookup(labelsQuery.data?.results ?? []),
    [labelsQuery.data],
  )

  const sorting: SortingState = sort ? [{ id: sort, desc: dir === 'desc' }] : []

  function handleSortingChange(next: SortingState) {
    const first = next[0]
    navigate({
      search: (prev) => ({
        ...prev,
        page: 1,
        sort: first?.id,
        dir: first ? (first.desc ? 'desc' : 'asc') : undefined,
      }),
    })
  }

  function handleFiltersChange(next: Array<ColumnFilter>) {
    navigate({
      search: (prev) => ({
        ...prev,
        page: 1,
        filters: next.length > 0 ? next : undefined,
      }),
    })
  }

  return (
    <div className="mx-auto max-w-full">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-xl font-semibold tracking-tight">
              {table}
            </h1>
            {meta.kind !== 'table' && (
              <Badge variant="outline">
                {meta.kind === 'materialized view' ? 'matview' : meta.kind}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            {meta.columns.length} columns
            {meta.foreignKeys.length > 0 && (
              <> · {meta.foreignKeys.length} foreign keys</>
            )}
          </p>
        </div>
        {writeEnabled && meta.kind === 'table' && <CreateRowButton meta={meta} />}
      </div>

      {rowsPage ? (
        <DataTable
          meta={meta}
          rows={rowsPage.rows}
          writeEnabled={writeEnabled}
          fkLabels={fkLabels}
          sorting={sorting}
          onSortingChange={handleSortingChange}
          page={page}
          pageSize={pageSize}
          total={rowsPage.total}
          isFetching={rowsQuery.isFetching}
          onPageChange={(p) =>
            navigate({ search: (prev) => ({ ...prev, page: p }) })
          }
          onPageSizeChange={(s) =>
            navigate({ search: (prev) => ({ ...prev, page: 1, pageSize: s }) })
          }
          search={q ?? ''}
          onSearchChange={(value) =>
            navigate({
              search: (prev) => ({
                ...prev,
                page: 1,
                q: value.trim() === '' ? undefined : value,
              }),
            })
          }
          filters={activeFilters}
          onFiltersChange={handleFiltersChange}
        />
      ) : (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full max-w-xs" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}
    </div>
  )
}
