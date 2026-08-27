import { useEffect, useState } from 'react'

import {
  FILTER_OP_LABELS,
  UNARY_OPS,
  type ColumnMeta,
  type FilterOp,
  type FilterSpec,
} from '~/lib/types'

const OP_ORDER: Array<FilterOp> = [
  'eq',
  'neq',
  'ilike',
  'gt',
  'gte',
  'lt',
  'lte',
  'is_null',
  'is_not_null',
]

function isUnary(op: FilterOp): boolean {
  return UNARY_OPS.includes(op)
}

/**
 * Free-text search + a per-column filter builder. State is fully controlled by
 * the parent (which persists it in URL search params); this component only
 * collects input and emits changes.
 */
export function FilterBar({
  columns,
  search,
  filters,
  onSearchChange,
  onFiltersChange,
}: {
  columns: Array<ColumnMeta>
  search: string
  filters: Array<FilterSpec>
  onSearchChange: (value: string) => void
  onFiltersChange: (filters: Array<FilterSpec>) => void
}) {
  // Local draft for the search input so typing does not hit the server on
  // every keystroke; committed on submit / blur.
  const [draft, setDraft] = useState(search)
  useEffect(() => setDraft(search), [search])

  const [column, setColumn] = useState(columns[0]?.name ?? '')
  const [op, setOp] = useState<FilterOp>('eq')
  const [value, setValue] = useState('')

  function addFilter() {
    if (!column) return
    const spec: FilterSpec = isUnary(op)
      ? { column, op }
      : { column, op, value }
    onFiltersChange([...filters, spec])
    setValue('')
  }

  function removeFilter(index: number) {
    onFiltersChange(filters.filter((_, i) => i !== index))
  }

  return (
    <div className="filter-bar">
      <div className="filter-row">
        <form
          className="search-form"
          onSubmit={(e) => {
            e.preventDefault()
            onSearchChange(draft.trim())
          }}
        >
          <input
            type="search"
            className="search-input"
            placeholder="Search all columns…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onSearchChange(draft.trim())
              }
            }}
            onBlur={() => {
              if (draft.trim() !== search) onSearchChange(draft.trim())
            }}
            aria-label="Search all columns"
          />
        </form>

        <div className="filter-builder">
          <select
            aria-label="Filter column"
            value={column}
            onChange={(e) => setColumn(e.target.value)}
          >
            {columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter operator"
            value={op}
            onChange={(e) => setOp(e.target.value as FilterOp)}
          >
            {OP_ORDER.map((o) => (
              <option key={o} value={o}>
                {FILTER_OP_LABELS[o]}
              </option>
            ))}
          </select>
          {!isUnary(op) && (
            <input
              type="text"
              className="filter-value"
              placeholder="value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addFilter()
                }
              }}
              aria-label="Filter value"
            />
          )}
          <button type="button" className="btn" onClick={addFilter}>
            + filter
          </button>
        </div>
      </div>

      {filters.length > 0 && (
        <div className="filter-chips">
          {filters.map((f, i) => (
            <span key={`${f.column}-${f.op}-${i}`} className="chip">
              <code>{f.column}</code> {FILTER_OP_LABELS[f.op]}
              {!isUnary(f.op) && <> {String(f.value ?? '')}</>}
              <button
                type="button"
                className="chip-x"
                onClick={() => removeFilter(i)}
                aria-label={`Remove filter on ${f.column}`}
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            className="chip-clear"
            onClick={() => onFiltersChange([])}
          >
            clear all
          </button>
        </div>
      )}
    </div>
  )
}
