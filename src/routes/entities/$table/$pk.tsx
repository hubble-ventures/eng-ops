import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { CellValue } from '~/components/CellValue'
import { EntityTable } from '~/components/EntityTable'
import { ErrorPanel } from '~/components/ErrorPanel'
import { entityOverviewQuery, entityMetaQuery, entityRowsQuery } from '~/lib/queries'
import type { TableMeta } from '~/lib/types'

const searchSchema = z.object({
  pkColumn: z.string().min(1).optional(),
})

export const Route = createFileRoute('/entities/$table/$pk')({
  validateSearch: searchSchema,
  beforeLoad: ({ params }) => ({ crumb: `${params.table} / ${params.pk}` }),
  loaderDeps: ({ search }) => ({ pkColumn: search.pkColumn }),
  loader: async ({ params, context, deps }) => {
    const meta = await context.queryClient.ensureQueryData(
      entityMetaQuery(params.table),
    )
    const pkColumn = deps.pkColumn ?? meta.columns.find((c) => c.isPrimaryKey)?.name
    if (!pkColumn) {
      throw new Error(
        `No primary key known for ${params.table}; pass ?pkColumn=<column> in the URL`,
      )
    }
    const overview = await context.queryClient.ensureQueryData(
      entityOverviewQuery(params.table, pkColumn, params.pk),
    )
    return { overview, pkColumn }
  },
  errorComponent: ErrorPanel,
  component: EntityOverviewPage,
})

function EntityOverviewPage() {
  const { overview } = Route.useLoaderData()
  const { row, links, related } = overview
  const tableId = overview.table.id

  return (
    <div className="overview">
      <div className="toolbar">
        <h1 style={{ margin: 0, fontSize: '1.3rem' }}>
          <Link
            to="/entities/$table"
            params={{ table: tableId }}
            search={{ page: 1, pageSize: 50 }}
            style={{ fontFamily: 'var(--mono)' }}
          >
            {tableId}
          </Link>{' '}
          <span className="muted" style={{ fontWeight: 400 }}>
            / {overview.pkValue}
          </span>
        </h1>
      </div>

      {links.length > 0 && (
        <div className="card">
          <div className="section-title">
            <h2>Links</h2>
            <span className="muted">{links.length} references</span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {links.map((l) => (
              <Link
                key={l.column}
                to="/entities/$table/$pk"
                params={{ table: l.referencedTable, pk: String(l.value) }}
                search={{ pkColumn: l.referencedColumn }}
                className="pill"
                title={`${l.column} → ${l.referencedTable}.${l.referencedColumn}`}
              >
                {l.column}: {String(l.value)}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="section-title">
          <h2>Record</h2>
        </div>
        <table className="kv-table">
          <tbody>
            {overview.table.columns.map((c) => (
              <tr key={c.name}>
                <th scope="row">
                  {c.name}
                  {c.isPrimaryKey && <span className="badge">pk</span>}
                </th>
                <td>
                  <CellValue
                    value={row[c.name]}
                    column={c}
                    foreignKeys={overview.table.foreignKeys}
                    mode="detail"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {related.length > 0 && (
        <>
          <div className="section-title" style={{ margin: '1.5rem 0 0.75rem' }}>
            <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Related entities</h2>
            <span className="muted">{related.length} inbound references</span>
          </div>
          {related.map((r) => (
            <RelatedSection
              key={r.constraintName}
              fromTable={r.fromTable}
              fromColumn={r.fromColumn}
              pkValue={overview.pkValue}
            />
          ))}
        </>
      )}
    </div>
  )
}

function RelatedSection({
  fromTable,
  fromColumn,
  pkValue,
}: {
  fromTable: string
  fromColumn: string
  pkValue: string
}) {
  const metaQuery = useQuery(entityMetaQuery(fromTable))
  const rowsQuery = useQuery(
    entityRowsQuery(fromTable, {
      limit: 10,
      offset: 0,
      filterColumn: fromColumn,
      filterValue: pkValue,
    }),
  )

  const meta: TableMeta | undefined = metaQuery.data
  const page = rowsQuery.data

  return (
    <div className="card">
      <div className="section-title">
        <h2 style={{ fontFamily: 'var(--mono)' }}>
          <Link
            to="/entities/$table"
            params={{ table: fromTable }}
            search={{ page: 1, pageSize: 50 }}
          >
            {fromTable}
          </Link>
        </h2>
        <span className="muted">
          where <code>{fromColumn}</code> ={' '}
          <span className="rel-filter-val" title={pkValue}>
            {pkValue}
          </span>
          {page && <> &middot; {page.total} rows</>}
        </span>
      </div>
      {meta && page ? (
        page.total > 0 ? (
          <EntityTable
            tableId={fromTable}
            columns={meta.columns}
            foreignKeys={meta.foreignKeys}
            page={page}
          />
        ) : (
          <div className="muted">No related rows.</div>
        )
      ) : (
        <div className="loading">Loading…</div>
      )}
      {page && page.total > page.limit && (
        <div style={{ marginTop: '0.5rem' }}>
          <span className="muted">
            Showing first {page.limit} of {page.total}.
          </span>
        </div>
      )}
    </div>
  )
}
