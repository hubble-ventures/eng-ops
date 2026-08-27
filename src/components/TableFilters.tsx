import * as React from 'react'
import { ListFilter, X } from 'lucide-react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command'
import { Input } from '~/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '~/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import {
  NO_VALUE_OPS,
  OPS_FOR_KIND,
  OP_LABEL,
  columnKind,
  isFilterComplete,
  valueInputType,
  type ColumnFilter,
  type FilterKind,
} from '~/lib/filters'
import type { ColumnMeta, TableMeta } from '~/lib/types'

const KIND_LABEL: Record<FilterKind, string> = {
  text: 'text',
  number: 'number',
  date: 'date',
  boolean: 'bool',
  enum: 'enum',
  fk: 'fk',
}

export function TableFilters({
  meta,
  filters,
  onChange,
}: {
  meta: TableMeta
  filters: Array<ColumnFilter>
  onChange: (filters: Array<ColumnFilter>) => void
}) {
  const fkColumns = React.useMemo(
    () => new Set(meta.foreignKeys.map((f) => f.column)),
    [meta.foreignKeys],
  )
  const kindOf = React.useCallback(
    (name: string): FilterKind => {
      const col = meta.columns.find((c) => c.name === name)
      if (!col) return 'text'
      return columnKind(col, fkColumns.has(name))
    },
    [meta.columns, fkColumns],
  )

  function addFilter(f: ColumnFilter) {
    onChange([...filters, f])
  }
  function replaceFilter(index: number, f: ColumnFilter) {
    onChange(filters.map((prev, i) => (i === index ? f : prev)))
  }
  function removeFilter(index: number) {
    onChange(filters.filter((_, i) => i !== index))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((filter, i) => (
        <FilterChip
          key={`${filter.column}-${i}`}
          meta={meta}
          filter={filter}
          kind={kindOf(filter.column)}
          onApply={(f) => replaceFilter(i, f)}
          onRemove={() => removeFilter(i)}
        />
      ))}

      <FilterPopover meta={meta} kindOf={kindOf} onApply={addFilter}>
        <Button variant="outline" size="sm" className="border-dashed">
          <ListFilter />
          <span className="hidden sm:inline">Filter</span>
        </Button>
      </FilterPopover>

      {filters.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => onChange([])}
        >
          Clear
        </Button>
      )}
    </div>
  )
}

function FilterChip({
  meta,
  filter,
  kind,
  onApply,
  onRemove,
}: {
  meta: TableMeta
  filter: ColumnFilter
  kind: FilterKind
  onApply: (f: ColumnFilter) => void
  onRemove: () => void
}) {
  const valueText = NO_VALUE_OPS.has(filter.op) ? '' : String(filter.value ?? '')
  return (
    <Badge
      variant="secondary"
      className="h-7 gap-1 rounded-md pr-1 pl-2 font-normal"
    >
      <FilterPopover
        meta={meta}
        kindOf={() => kind}
        initial={filter}
        onApply={onApply}
      >
        <button type="button" className="inline-flex items-center gap-1">
          <span className="font-mono">{filter.column}</span>
          <span className="text-muted-foreground">{OP_LABEL[filter.op]}</span>
          {valueText && (
            <span className="text-foreground max-w-[12rem] truncate font-medium">
              {valueText}
            </span>
          )}
        </button>
      </FilterPopover>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${filter.column} filter`}
        className="hover:bg-background/60 rounded p-0.5"
      >
        <X className="size-3" />
      </button>
    </Badge>
  )
}

/**
 * Popover that edits one filter. When `initial` is set it edits that filter;
 * otherwise it builds a new one, starting from a searchable column picker.
 */
function FilterPopover({
  meta,
  kindOf,
  initial,
  onApply,
  children,
}: {
  meta: TableMeta
  kindOf: (name: string) => FilterKind
  initial?: ColumnFilter
  onApply: (f: ColumnFilter) => void
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<ColumnFilter | null>(initial ?? null)

  // Reset the draft each time the popover opens so it always reflects `initial`.
  React.useEffect(() => {
    if (open) setDraft(initial ?? null)
  }, [open, initial])

  function pickColumn(name: string) {
    const kind = kindOf(name)
    const op = OPS_FOR_KIND[kind][0] ?? 'eq'
    setDraft({ column: name, op, value: NO_VALUE_OPS.has(op) ? undefined : '' })
  }

  function apply() {
    if (draft && isFilterComplete(draft)) {
      onApply(draft)
      setOpen(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        {!draft ? (
          <Command>
            <CommandInput placeholder="Filter a column…" />
            <CommandList>
              <CommandEmpty>No column found.</CommandEmpty>
              <CommandGroup>
                {meta.columns.map((c) => (
                  <CommandItem
                    key={c.name}
                    value={c.name}
                    onSelect={() => pickColumn(c.name)}
                  >
                    <span className="truncate font-mono text-xs">{c.name}</span>
                    <Badge
                      variant="outline"
                      className="ml-auto text-[10px]"
                    >
                      {KIND_LABEL[kindOf(c.name)]}
                    </Badge>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        ) : (
          <FilterForm
            column={meta.columns.find((c) => c.name === draft.column)}
            kind={kindOf(draft.column)}
            draft={draft}
            onDraftChange={setDraft}
            onApply={apply}
            onBack={initial ? undefined : () => setDraft(null)}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function FilterForm({
  column,
  kind,
  draft,
  onDraftChange,
  onApply,
  onBack,
}: {
  column: ColumnMeta | undefined
  kind: FilterKind
  draft: ColumnFilter
  onDraftChange: (f: ColumnFilter) => void
  onApply: () => void
  onBack?: () => void
}) {
  const ops = OPS_FOR_KIND[kind]
  const needsValue = !NO_VALUE_OPS.has(draft.op)

  function setOp(op: ColumnFilter['op']) {
    onDraftChange({
      ...draft,
      op,
      value: NO_VALUE_OPS.has(op) ? undefined : (draft.value ?? ''),
    })
  }
  function setValue(value: string) {
    onDraftChange({ ...draft, value })
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground text-xs"
          >
            ←
          </button>
        )}
        <span className="truncate font-mono text-sm font-medium">
          {draft.column}
        </span>
      </div>

      <Select value={draft.op} onValueChange={(v) => setOp(v as ColumnFilter['op'])}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ops.map((op) => (
            <SelectItem key={op} value={op}>
              {OP_LABEL[op]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {needsValue &&
        (kind === 'enum' && column?.enumValues ? (
          <Select
            value={typeof draft.value === 'string' ? draft.value : ''}
            onValueChange={setValue}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Select value…" />
            </SelectTrigger>
            <SelectContent>
              {column.enumValues.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            autoFocus
            type={valueInputType(kind)}
            value={draft.value == null ? '' : String(draft.value)}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onApply()
              }
            }}
            placeholder="Value…"
          />
        ))}

      <Button
        size="sm"
        className="w-full"
        disabled={!isFilterComplete(draft)}
        onClick={onApply}
      >
        Apply filter
      </Button>
    </div>
  )
}
