import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { EntityTable } from '~/components/EntityTable'
import { entityMetaQuery, entityRowsQuery } from '~/lib/queries'

const searchSchema = z.object({
  page: z.number().int().min(1).catch(1),
  pageSize: z.number().int().min(1).max(200).catch(50),
})

export const Route = createFileRoute('/entities/$table/')({
  validateSearch: searchSchema,
  beforeLoad: ({ params }) => ({ crumb: params.table }),
  loaderDeps: ({ search }) => ({ page: search.page, pageSize: search.pageSize }),
  loader: async ({ params, context, deps }) => {
    const meta = await context.queryClient.ensureQueryData(
      entityMetaQuery(params.table),
    )
    await context.queryClient.ensureQueryData(
      entityRowsQuery(params.table, {
        limit: deps.pageSize,
        offset: (deps.page - 1) * deps.pageSize,
      }),
    )
    return { meta }
  },
  component: EntityListPage,
})

function EntityListPage() {
  const { table } = Route.useParams()
  const { page, pageSize } = Route.useSearch()
  const { meta } = Route.useLoaderData()

  const { data: rowsPage } = useQuery(
    entityRowsQuery(table, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
  )

  const totalPages = rowsPage ? Math.max(1, Math.ceil(rowsPage.total / pageSize)) : 1

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
            search={{ page: page - 1, pageSize }}
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
          </span>
          <Link
            to="/entities/$table"
            params={{ table }}
            search={{ page: page + 1, pageSize }}
            className="btn"
            style={
              page >= totalPages ? { pointerEvents: 'none', opacity: 0.45 } : undefined
            }
          >
            next &rarr;
          </Link>
        </div>
      </div>

      {rowsPage ? (
        <EntityTable
          tableId={table}
          columns={meta.columns}
          foreignKeys={meta.foreignKeys}
          page={rowsPage}
        />
      ) : (
        <div className="loading">Loading rows…</div>
      )}
    </>
  )
}
