import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Database, Search, Table2, X } from 'lucide-react'

import { ThemeToggle } from '~/components/ThemeToggle'
import { Input } from '~/components/ui/input'
import { entitiesListQuery } from '~/lib/queries'
import { cn } from '~/lib/utils'
import type { EntitySummary } from '~/lib/types'

export function AppSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data } = useQuery(entitiesListQuery())
  const [filter, setFilter] = React.useState('')

  const groups = React.useMemo(() => {
    const entities = data?.entities ?? []
    const q = filter.trim().toLowerCase()
    const filtered = q
      ? entities.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.id.toLowerCase().includes(q),
        )
      : entities
    const bySchema = new Map<string, Array<EntitySummary>>()
    for (const e of filtered) {
      const list = bySchema.get(e.schema) ?? []
      list.push(e)
      bySchema.set(e.schema, list)
    }
    return [...bySchema.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [data, filter])

  const total = data?.entities.length ?? 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-3">
        <Link
          to="/"
          onClick={onNavigate}
          className="flex items-center gap-2 font-semibold"
        >
          <Database className="text-link size-5" />
          eng-ops
        </Link>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={`Filter ${total} tables…`}
            className="h-8 pr-8 pl-8"
          />
          {filter && (
            <button
              type="button"
              onClick={() => setFilter('')}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
              aria-label="Clear filter"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {groups.length === 0 && (
          <p className="text-muted-foreground px-3 py-4 text-sm">
            No tables match.
          </p>
        )}
        {groups.map(([schema, tables]) => (
          <div key={schema} className="mb-3">
            <div className="text-muted-foreground bg-background/80 sticky top-0 px-3 py-1 text-xs font-medium tracking-wide uppercase backdrop-blur">
              {schema}
              <span className="ml-1 opacity-60">{tables.length}</span>
            </div>
            <ul>
              {tables.map((e) => (
                <li key={e.id}>
                  <Link
                    to="/entities/$table"
                    params={{ table: e.id }}
                    search={{ page: 1, pageSize: 50 }}
                    onClick={onNavigate}
                    className="text-muted-foreground hover:bg-accent hover:text-accent-foreground flex items-center gap-2 rounded-md px-3 py-1.5 text-sm"
                    activeProps={{
                      className: cn(
                        'bg-accent text-accent-foreground font-medium',
                      ),
                    }}
                  >
                    <Table2 className="size-3.5 shrink-0 opacity-60" />
                    <span className="truncate font-mono text-[13px]">
                      {e.name}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  )
}
