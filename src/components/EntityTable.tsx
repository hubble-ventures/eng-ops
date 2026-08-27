import { Link } from '@tanstack/react-router'

import { CellValue } from '~/components/CellValue'
import type { ColumnMeta, ForeignKeyMeta, RowsPage, SortDir } from '~/lib/types'

export function primaryKeyOf(columns: Array<ColumnMeta>): ColumnMeta | undefined {
  return columns.find((c) => c.isPrimaryKey)
}

/**
 * Optional interactive sorting for the header row. `onToggle` returns the next
 * sort direction for a column (or `null` to clear), letting the caller drive
 * sorting through URL search params.
 */
export interface SortControl {
  active?: { column: string; dir: SortDir }
  onToggle: (column: string) => void
}

export function nextDir(active: SortControl['active'], column: string): SortDir | null {
  if (active?.column !== column) return 'asc'
  if (active.dir === 'asc') return 'desc'
  return null
}

export function EntityTable({
  tableId,
  columns,
  foreignKeys,
  page,
  sortControl,
}: {
  tableId: string
  columns: Array<ColumnMeta>
  foreignKeys: Array<ForeignKeyMeta>
  page: RowsPage
  sortControl?: SortControl
}) {
  const pk = primaryKeyOf(columns)

  if (page.rows.length === 0) {
    return (
      <div className="card muted" role="status">
        No rows found.
      </div>
    )
  }

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => {
              const isActive = sortControl?.active?.column === c.name
              const arrow = isActive
                ? sortControl?.active?.dir === 'desc'
                  ? ' ↓'
                  : ' ↑'
                : ''
              return (
                <th
                  key={c.name}
                  scope="col"
                  title={`${c.dataType}${c.nullable ? ' (nullable)' : ''}`}
                  aria-sort={
                    !sortControl
                      ? undefined
                      : isActive
                        ? sortControl.active?.dir === 'desc'
                          ? 'descending'
                          : 'ascending'
                        : 'none'
                  }
                >
                  {sortControl ? (
                    <button
                      type="button"
                      className={`th-sort${isActive ? ' active' : ''}`}
                      onClick={() => sortControl.onToggle(c.name)}
                      title={`Sort by ${c.name} (${
                        nextDir(sortControl.active, c.name) ?? 'clear'
                      })`}
                    >
                      {c.name}
                      {c.isPrimaryKey && <span className="badge">pk</span>}
                      <span className="th-arrow">{arrow}</span>
                    </button>
                  ) : (
                    <>
                      {c.name}
                      {c.isPrimaryKey && <span className="badge">pk</span>}
                    </>
                  )}
                </th>
              )
            })}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {page.rows.map((row, i) => {
            const pkValue = pk ? row[pk.name] : undefined
            return (
              <tr key={pkValue !== undefined && pkValue !== null ? String(pkValue) : i}>
                {columns.map((c) => (
                  <td key={c.name} className="truncated">
                    <CellValue value={row[c.name]} column={c} foreignKeys={foreignKeys} />
                  </td>
                ))}
                <td>
                  {pk && pkValue !== undefined && pkValue !== null ? (
                    <Link
                      to="/entities/$table/$pk"
                      params={{ table: tableId, pk: String(pkValue) }}
                      search={{ pkColumn: pk.name }}
                      aria-label={`View ${pk.name} ${String(pkValue)}`}
                    >
                      view
                    </Link>
                  ) : (
                    <span className="muted" title="No primary key on this table">
                      —
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
