import { Link } from '@tanstack/react-router'

import { CellValue } from '~/components/CellValue'
import type { ColumnMeta, ForeignKeyMeta, RowsPage } from '~/lib/types'

export function primaryKeyOf(columns: Array<ColumnMeta>): ColumnMeta | undefined {
  return columns.find((c) => c.isPrimaryKey)
}

export function EntityTable({
  tableId,
  columns,
  foreignKeys,
  page,
}: {
  tableId: string
  columns: Array<ColumnMeta>
  foreignKeys: Array<ForeignKeyMeta>
  page: RowsPage
}) {
  const pk = primaryKeyOf(columns)

  if (page.rows.length === 0) {
    return <div className="card muted">No rows found.</div>
  }

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.name} title={`${c.dataType}${c.nullable ? ' (nullable)' : ''}`}>
                {c.name}
                {c.isPrimaryKey && <span className="badge">pk</span>}
              </th>
            ))}
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
