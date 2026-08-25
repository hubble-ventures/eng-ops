import { Link } from '@tanstack/react-router'

import type { ColumnMeta, ForeignKeyMeta, MaybeScalar } from '~/lib/types'

export function CellValue({
  value,
  column,
  foreignKeys,
}: {
  value: MaybeScalar
  column: ColumnMeta
  foreignKeys: Array<ForeignKeyMeta>
}) {
  if (value === null || value === undefined) {
    return <span className="null">NULL</span>
  }

  const fk = foreignKeys.find((f) => f.column === column.name)
  const text = String(value)

  if (fk) {
    return (
      <Link
        to="/entities/$table/$pk"
        params={{ table: fk.referencedTable, pk: text }}
        search={{ pkColumn: fk.referencedColumn }}
        className="cell-link"
        title={`${fk.referencedTable}.${fk.referencedColumn} = ${text}`}
      >
        {text}
      </Link>
    )
  }

  if (typeof value === 'boolean') {
    return <span className="cell-link">{value ? 'true' : 'false'}</span>
  }

  return <span title={text.length > 60 ? text : undefined}>{text}</span>
}
