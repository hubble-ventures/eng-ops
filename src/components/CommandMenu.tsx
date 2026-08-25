import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Home, Table2 } from 'lucide-react'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'
import { entitiesListQuery } from '~/lib/queries'
import type { EntitySummary } from '~/lib/types'

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { data } = useQuery(entitiesListQuery())
  const navigate = useNavigate()

  const groups = React.useMemo(() => {
    const bySchema = new Map<string, Array<EntitySummary>>()
    for (const e of data?.entities ?? []) {
      const list = bySchema.get(e.schema) ?? []
      list.push(e)
      bySchema.set(e.schema, list)
    }
    return [...bySchema.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [data])

  function goToTable(id: string) {
    onOpenChange(false)
    navigate({
      to: '/entities/$table',
      params: { table: id },
      search: { page: 1, pageSize: 50 },
    })
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search tables…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          <CommandItem
            value="home"
            onSelect={() => {
              onOpenChange(false)
              navigate({ to: '/' })
            }}
          >
            <Home />
            Home
          </CommandItem>
        </CommandGroup>
        {groups.map(([schema, tables]) => (
          <CommandGroup key={schema} heading={schema}>
            {tables.map((e) => (
              <CommandItem
                key={e.id}
                value={e.id}
                keywords={[e.name, e.schema]}
                onSelect={() => goToTable(e.id)}
              >
                <Table2 />
                <span className="font-mono text-[13px]">{e.name}</span>
                <span className="text-muted-foreground ml-auto text-xs">
                  {e.kind !== 'table'
                    ? e.kind === 'materialized view'
                      ? 'matview'
                      : e.kind
                    : e.schema}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
