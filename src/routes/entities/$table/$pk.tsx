import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import { z } from 'zod'

import { CellValue } from '~/components/CellValue'
import { MergeRecordButton } from '~/components/MergeRecordDialog'
import { DeleteRowButton, EditRowButton } from '~/components/RecordDialogs'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Skeleton } from '~/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import {
  buildLabelLookup,
  entitiesListQuery,
  entityLabelsQuery,
  entityMetaQuery,
  entityOverviewQuery,
  entityRowsQuery,
  lookupLabel,
  type LabelRequest,
} from '~/lib/queries'
import type { JsonScalar, TableMeta } from '~/lib/types'

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
  component: EntityOverviewPage,
})

function EntityOverviewPage() {
  const loaderData = Route.useLoaderData()
  const { table, pk } = Route.useParams()
  // Read through a live query (seeded by the loader) so edits re-render.
  const { data: overview = loaderData.overview } = useQuery(
    entityOverviewQuery(table, loaderData.pkColumn, pk),
  )
  const { row, links, related } = overview
  const tableId = overview.table.id
  const navigate = useNavigate()

  // Resolve outbound FK values to labels for the References + Record cards.
  const linkRequests = React.useMemo<Array<LabelRequest>>(() => {
    const byTarget = new Map<
      string,
      { table: string; column: string; values: Set<JsonScalar> }
    >()
    for (const l of links) {
      const key = `${l.referencedTable}.${l.referencedColumn}`
      const bucket = byTarget.get(key) ?? {
        table: l.referencedTable,
        column: l.referencedColumn,
        values: new Set<JsonScalar>(),
      }
      bucket.values.add(l.value)
      byTarget.set(key, bucket)
    }
    return [...byTarget.values()].map((b) => ({
      table: b.table,
      column: b.column,
      values: [...b.values],
    }))
  }, [links])
  const labelsQuery = useQuery(entityLabelsQuery(linkRequests))
  const fkLabels = React.useMemo(
    () => buildLabelLookup(labelsQuery.data?.results ?? []),
    [labelsQuery.data],
  )
  const writeEnabled = useQuery(entitiesListQuery()).data?.writeEnabled ?? false
  const canWrite = writeEnabled && overview.table.kind === 'table'

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">
          <Link
            to="/entities/$table"
            params={{ table: tableId }}
            search={{ page: 1, pageSize: 50 }}
            className="text-link font-mono underline-offset-4 hover:underline"
          >
            {tableId}
          </Link>{' '}
          <span className="text-muted-foreground font-mono font-normal">
            / {overview.pkValue}
          </span>
        </h1>
        {canWrite && (
          <div className="flex gap-2">
            <EditRowButton meta={overview.table} row={row} />
            {overview.table.columns.some((c) => c.isPrimaryKey) && (
              <MergeRecordButton
                meta={overview.table}
                row={row}
                pkColumn={loaderData.pkColumn}
              />
            )}
            <DeleteRowButton
              meta={overview.table}
              row={row}
              onDeleted={() =>
                navigate({
                  to: '/entities/$table',
                  params: { table: tableId },
                  search: { page: 1, pageSize: 50 },
                })
              }
            />
          </div>
        )}
      </div>

      {links.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              References{' '}
              <span className="text-muted-foreground text-sm font-normal">
                {links.length}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {links.map((l) => (
              <Link
                key={l.column}
                to="/entities/$table/$pk"
                params={{ table: l.referencedTable, pk: String(l.value) }}
                search={{ pkColumn: l.referencedColumn }}
                title={`${l.column} → ${l.referencedTable}.${l.referencedColumn}`}
                className="min-w-0 max-w-full"
              >
                <Badge
                  variant="outline"
                  className="hover:bg-accent max-w-full gap-1 font-mono"
                >
                  <span className="text-muted-foreground shrink-0">
                    {l.column}:
                  </span>
                  <span className="truncate">
                    {lookupLabel(fkLabels, l.referencedTable, l.value) ??
                      String(l.value)}
                  </span>
                  <ArrowUpRight className="size-3 shrink-0 opacity-60" />
                </Badge>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Record</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 lg:grid-cols-2">
            {overview.table.columns.map((c) => (
              <div
                key={c.name}
                className="grid grid-cols-[minmax(8rem,10rem)_1fr] items-baseline gap-2 border-b py-2 last:border-0"
              >
                <dt className="text-muted-foreground inline-flex items-center gap-1.5 font-mono text-xs">
                  {c.name}
                  {c.isPrimaryKey && (
                    <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                      pk
                    </Badge>
                  )}
                </dt>
                <dd className="min-w-0 text-sm break-words">
                  <CellValue
                    value={row[c.name]}
                    column={c}
                    foreignKeys={overview.table.foreignKeys}
                    labels={fkLabels}
                    expandable
                  />
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {related.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-semibold">Related entities</h2>
            <span className="text-muted-foreground text-sm">
              {related.length} inbound references
            </span>
          </div>
          {related.map((r) => (
            <RelatedSection
              key={r.constraintName}
              fromTable={r.fromTable}
              fromColumn={r.fromColumn}
              pkValue={overview.pkValue}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const RELATED_LIMIT = 10

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
      limit: RELATED_LIMIT,
      offset: 0,
      filterColumn: fromColumn,
      filterValue: pkValue,
    }),
  )

  const meta: TableMeta | undefined = metaQuery.data
  const page = rowsQuery.data
  const pk = meta?.columns.find((c) => c.isPrimaryKey)?.name

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline gap-2 text-base">
          <Link
            to="/entities/$table"
            params={{ table: fromTable }}
            search={{ page: 1, pageSize: 50 }}
            className="text-link font-mono underline-offset-4 hover:underline"
          >
            {fromTable}
          </Link>
          <span className="text-muted-foreground text-sm font-normal">
            where <code className="font-mono">{fromColumn}</code> = {pkValue}
            {page && <> · {page.total} rows</>}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {meta && page ? (
          page.rows.length > 0 ? (
            <div className="rounded-lg border">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    {meta.columns.map((c) => (
                      <TableHead key={c.name} className="font-mono">
                        {c.name}
                      </TableHead>
                    ))}
                    <TableHead className="w-0" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.rows.map((r, i) => {
                    const rowPk = pk ? r[pk] : undefined
                    return (
                      <TableRow key={rowPk != null ? String(rowPk) : i}>
                        {meta.columns.map((c) => (
                          <TableCell
                            key={c.name}
                            className="max-w-[24rem] truncate py-1.5"
                          >
                            <CellValue
                              value={r[c.name]}
                              column={c}
                              foreignKeys={meta.foreignKeys}
                            />
                          </TableCell>
                        ))}
                        <TableCell className="py-1.5 text-right">
                          {pk && rowPk != null && (
                            <Link
                              to="/entities/$table/$pk"
                              params={{ table: fromTable, pk: String(rowPk) }}
                              search={{ pkColumn: pk }}
                              className="text-link text-sm underline-offset-4 hover:underline"
                            >
                              view
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No related rows.</p>
          )
        ) : (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )}
        {page && page.total > RELATED_LIMIT && (
          <p className="text-muted-foreground mt-2 text-sm">
            Showing first {RELATED_LIMIT} of {page.total}.{' '}
            <Link
              to="/entities/$table"
              params={{ table: fromTable }}
              search={{ page: 1, pageSize: 50 }}
              className="text-link underline-offset-4 hover:underline"
            >
              View all →
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
