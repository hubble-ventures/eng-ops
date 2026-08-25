import { Link } from '@tanstack/react-router'

import { lookupLabel } from '~/lib/queries'
import type {
  ColumnMeta,
  ForeignKeyMeta,
  JsonScalar,
  MaybeScalar,
} from '~/lib/types'

export function CellValue({
  value,
  column,
  foreignKeys,
  labels,
}: {
  value: MaybeScalar
  column: ColumnMeta
  foreignKeys: Array<ForeignKeyMeta>
  /** optional FK label lookup (see entityLabelsQuery) */
  labels?: Map<string, string>
}) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/60 italic">NULL</span>
  }

  const fk = foreignKeys.find((f) => f.column === column.name)
  const text = String(value)

  if (fk) {
    const label = lookupLabel(labels, fk.referencedTable, value as JsonScalar)
    const showLabel = !!label && label !== text
    return (
      <Link
        to="/entities/$table/$pk"
        params={{ table: fk.referencedTable, pk: text }}
        search={{ pkColumn: fk.referencedColumn }}
        className="text-link underline-offset-4 hover:underline"
        title={`${fk.referencedTable}.${fk.referencedColumn} = ${text}`}
        onClick={(e) => e.stopPropagation()}
      >
        {showLabel ? (
          <>
            {label}
            <span className="text-muted-foreground ml-1 font-mono text-xs">
              #{text}
            </span>
          </>
        ) : (
          <span className="font-mono">{text}</span>
        )}
      </Link>
    )
  }

  if (typeof value === 'boolean') {
    return (
      <span className="text-link font-mono">{value ? 'true' : 'false'}</span>
    )
  }

  if (typeof value === 'number') {
    return <span className="font-mono tabular-nums">{text}</span>
  }

  return (
    <span
      className="block max-w-[28rem] truncate"
      title={text.length > 60 ? text : undefined}
    >
      {text}
    </span>
  )
}
