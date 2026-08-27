import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useRouterState } from '@tanstack/react-router'
import { z } from 'zod'

import { EntityTable, nextDir } from '~/components/EntityTable'
import { ErrorPanel } from '~/components/ErrorPanel'
import { FilterBar } from '~/components/FilterBar'
import { entityMetaQuery, entityRowsQuery } from '~/lib/queries'
import type { FilterSpec } from '~/lib/types'

const filterOpSchema = z.enum([
  'eq',
  'neq',
  'ilike',
  'gt',
  'gte',
  'lt',
  'lte',
  'is_null',
  'is_not_null',
])

const filterSearchSchema = z.object({
  column: z.string(),
  op: filterOpSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
})

const searchSchema = z.object({
  page: z.number().int().min(1).catch(1),
  pageSize: z.number().int().min(1).max(200).catch(50),
  sort: z.string().optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  q: z.string().optional(),
  filters: z.array(filterSearchSchema).catch([]).optional(),
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
      entityRowsQuery(params.table, rowsOpts(deps)),
    )
    return { meta }
  },
  errorComponent: ErrorPanel,
  component: EntityListPage,
})

/** Build the query options object from route search/deps. */
function rowsOpts(deps: {
  page: number
  pageSize: number
  sort?: string | undefined
  dir?: 'asc' | 'desc' | undefined
  q?: string | undefined
  filters?: Array<FilterSpec> | undefined
}) {
  return {
    limit: deps.pageSize,
    offset: (deps.page - 1) * deps.pageSize,
    sort: deps.sort ? { column: deps.sort, dir: deps.dir ?? 'asc' } : undefined,
    search: deps.q,
    filters: deps.filters?.length ? deps.filters : undefined,
  }
}

function EntityListPage() {
  const { table } = Route.useParams()
  const search = Route.useSearch()
  const { page, pageSize, sort, dir } = search
  const { meta } = Route.useLoaderData()
  const navigate = Route.useNavigate()

  const { data: rowsPage, isFetching } = useQuery(
    entityRowsQuery(
      table,
      rowsOpts({ page, pageSize, sort, dir, q: search.q, filters: search.filters }),
    ),
  )
  // The route loader prefetches rows, so the wait shows up as a pending
  // navigation rather than useQuery.isFetching — reflect both.
  const isNavigating = useRouterState({ select: (s) => s.isLoading })
  const busy = isFetching || isNavigating

  const totalPages = rowsPage ? Math.max(1, Math.ceil(rowsPage.total / pageSize)) : 1
  const activeFilters = search.filters ?? []

  function toggleSort(column: string) {
    const next = nextDir(sort ? { column: sort, dir: dir ?? 'asc' } : undefined, column)
    navigate({
      search: {
        ...search,
        page: 1,
        sort: next ? column : undefined,
        dir: next ?? undefined,
      },
    })
  }

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, fontSize: '1.3rem', fontFamily: 'var(--mono)' }}>
          {table}
        </h1>
        <div className="pagination">
          <Link
            to="/entities/$table"
            params={{ table }}
            search={{ ...search, page: page - 1 }}
            className="btn"
            disabled={page <= 1}
            aria-disabled={page <= 1}
            style={page <= 1 ? { pointerEvents: 'none', opacity: 0.45 } : undefined}
          >
            &larr; prev
          </Link>
          <span>
            page {page} / {totalPages}
            {rowsPage && <> &middot; {rowsPage.total} rows</>}
            {busy && (
              <span className="muted" role="status">
                {' '}
                &middot; <span className="spinner" aria-hidden="true" /> updating…
              </span>
            )}
          </span>
          <Link
            to="/entities/$table"
            params={{ table }}
            search={{ ...search, page: page + 1 }}
            className="btn"
            style={
              page >= totalPages ? { pointerEvents: 'none', opacity: 0.45 } : undefined
            }
          >
            next &rarr;
          </Link>
        </div>
      </div>

      <FilterBar
        columns={meta.columns}
        search={search.q ?? ''}
        filters={activeFilters}
        onSearchChange={(value) =>
          navigate({
            search: { ...search, page: 1, q: value || undefined },
          })
        }
        onFiltersChange={(filters) =>
          navigate({
            search: {
              ...search,
              page: 1,
              filters: filters.length ? filters : undefined,
            },
          })
        }
      />

      {rowsPage ? (
        <div className={busy ? 'is-fetching' : undefined} aria-busy={busy}>
          <EntityTable
            tableId={table}
            columns={meta.columns}
            foreignKeys={meta.foreignKeys}
            page={rowsPage}
            sortControl={{
              active: sort ? { column: sort, dir: dir ?? 'asc' } : undefined,
              onToggle: toggleSort,
            }}
          />
        </div>
      ) : (
        <div className="loading">Loading rows…</div>
      )}
    </>
  )
}
