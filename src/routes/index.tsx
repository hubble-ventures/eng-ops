import * as React from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { KeyRound, Link2, Search, Table2 } from 'lucide-react'

import { Badge } from '~/components/ui/badge'
import { Card } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { entitiesListQuery } from '~/lib/queries'

export const Route = createFileRoute('/')({
  beforeLoad: () => ({ crumb: 'Home' }),
  loader: ({ context }) => context.queryClient.ensureQueryData(entitiesListQuery()),
  component: HomePage,
})

function HomePage() {
  const data = Route.useLoaderData()
  const [q, setQ] = React.useState('')

  const query = q.trim().toLowerCase()
  const entities = query
    ? data.entities.filter(
        (e) =>
          e.name.toLowerCase().includes(query) ||
          e.id.toLowerCase().includes(query),
      )
    : data.entities

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Entities</h1>
          <p className="text-muted-foreground text-sm">
            Browse and inspect tables in the connected database.
          </p>
        </div>
        <Badge variant="secondary" className="text-sm">
          {data.entities.length} tables
        </Badge>
      </div>

      <div className="relative mb-5 max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search tables…"
          className="pl-8"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entities.map((e) => (
          <Link
            key={e.id}
            to="/entities/$table"
            params={{ table: e.id }}
            search={{ page: 1, pageSize: 50 }}
            className="group"
          >
            <Card className="hover:border-ring/60 gap-2 p-4 transition-colors">
              <div className="flex items-center gap-2">
                <Table2 className="text-muted-foreground size-4 shrink-0" />
                <span
                  className="min-w-0 flex-1 truncate font-mono text-sm font-medium"
                  title={`${e.schema}.${e.name}`}
                >
                  <span className="text-muted-foreground">{e.schema}.</span>
                  {e.name}
                </span>
                {e.kind !== 'table' && (
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {e.kind === 'materialized view' ? 'matview' : e.kind}
                  </Badge>
                )}
              </div>
              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="inline-flex items-center gap-1">
                  <KeyRound className="size-3" />
                  {e.columnCount} columns
                </span>
                {e.outboundFkCount > 0 && (
                  <span className="inline-flex items-center gap-1">
                    <Link2 className="size-3" />
                    {e.outboundFkCount} fk
                  </span>
                )}
                {e.inboundRefCount > 0 && (
                  <span>referenced by {e.inboundRefCount}</span>
                )}
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {entities.length === 0 && (
        <p className="text-muted-foreground py-12 text-center text-sm">
          No tables match “{q}”.
        </p>
      )}
    </div>
  )
}
