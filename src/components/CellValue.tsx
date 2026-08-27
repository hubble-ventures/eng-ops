import { Link } from '@tanstack/react-router'

import { lookupLabel } from '~/lib/queries'
import { cn } from '~/lib/utils'
import type {
  ColumnMeta,
  ForeignKeyMeta,
  JsonScalar,
  MaybeScalar,
} from '~/lib/types'

function isJsonColumn(column: ColumnMeta) {
  return column.dataType === 'json' || column.dataType === 'jsonb'
}

/** Pretty-print a JSON string; fall back to the raw text if it doesn't parse. */
function prettyJson(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

export function CellValue({
  value,
  column,
  foreignKeys,
  labels,
  expandable = false,
}: {
  value: MaybeScalar
  column: ColumnMeta
  foreignKeys: Array<ForeignKeyMeta>
  /** optional FK label lookup (see entityLabelsQuery) */
  labels?: Map<string, string>
  /**
   * When true (e.g. the record detail page) long text and jsonb are rendered
   * in full — wrapped, or as a scrollable pretty-printed block — instead of
   * truncated to a single line. Dense table cells leave this off.
   */
  expandable?: boolean
}) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">NULL</span>
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
    // Boolean pill — distinct from FK links, and true vs. false read apart by
    // both color and the label text (color is never the only signal).
    return (
      <span
        className={cn(
          'inline-flex items-center rounded border px-1.5 py-0 font-mono text-xs',
          value
            ? 'border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
            : 'text-muted-foreground border-border bg-muted/40',
        )}
      >
        {value ? 'true' : 'false'}
      </span>
    )
  }

  if (typeof value === 'number') {
    return <span className="font-mono tabular-nums">{text}</span>
  }

  // Rich rendering on detail views: jsonb as a scrollable pretty block, long
  // text wrapped in full. Table cells (expandable=false) still truncate.
  if (expandable && isJsonColumn(column)) {
    return (
      <pre className="bg-muted/40 max-h-80 overflow-auto rounded border p-2 font-mono text-xs whitespace-pre">
        {prettyJson(text)}
      </pre>
    )
  }

  if (expandable) {
    return <span className="block break-words whitespace-pre-wrap">{text}</span>
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
