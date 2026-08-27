import { useState } from 'react'
import { Link } from '@tanstack/react-router'

import type { ColumnMeta, ForeignKeyMeta, MaybeScalar } from '~/lib/types'

/** How much room the cell has: dense table cell vs. roomy detail view. */
export type CellMode = 'cell' | 'detail'

const TIMESTAMP_UDT = new Set(['timestamptz', 'timestamp'])

function isTimestampType(c: ColumnMeta): boolean {
  return TIMESTAMP_UDT.has(c.udtName) || c.dataType.includes('timestamp')
}
function isDateType(c: ColumnMeta): boolean {
  return c.udtName === 'date' || c.dataType === 'date'
}
function isJsonType(c: ColumnMeta): boolean {
  return c.udtName === 'json' || c.udtName === 'jsonb'
}
function isArrayType(c: ColumnMeta): boolean {
  return c.udtName.startsWith('_') || c.dataType === 'ARRAY'
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Reformat a server-serialized ISO string (values cross the wire as
 * `Date.toISOString()`) into a compact, readable UTC date/time. Returns null
 * when the string is not a parseable instant so the caller can fall back.
 */
function formatIso(value: string, withTime: boolean): { date: string; time?: string } | null {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  if (!withTime) return { date }
  return { date, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` }
}

export function CellValue({
  value,
  column,
  foreignKeys,
  mode = 'cell',
}: {
  value: MaybeScalar
  column: ColumnMeta
  foreignKeys: Array<ForeignKeyMeta>
  mode?: CellMode
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
    return (
      <span className={`bool ${value ? 'bool-true' : 'bool-false'}`}>
        {value ? 'true' : 'false'}
      </span>
    )
  }

  if (typeof value === 'string' && (isTimestampType(column) || isDateType(column))) {
    const f = formatIso(value, isTimestampType(column))
    if (f) {
      return (
        <span className="ts" title={value}>
          {f.date}
          {f.time && <span className="ts-time"> {f.time}</span>}
        </span>
      )
    }
  }

  if (typeof value === 'string' && (isJsonType(column) || isArrayType(column))) {
    return <JsonCell raw={value} mode={mode} isArray={isArrayType(column)} />
  }

  if (mode === 'detail' && text.length > 140) {
    return <ExpandableText text={text} />
  }

  return <span title={text.length > 60 ? text : undefined}>{text}</span>
}

function JsonCell({
  raw,
  mode,
  isArray,
}: {
  raw: string
  mode: CellMode
  isArray: boolean
}) {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return <span title={raw}>{raw}</span>
  }

  if (isArray && Array.isArray(parsed)) {
    const items = parsed as Array<unknown>
    if (items.length === 0) return <span className="muted">[]</span>
    const shown = mode === 'cell' ? items.slice(0, 4) : items
    return (
      <span className="arr">
        {shown.map((it, i) => (
          <span key={i} className="arr-chip">
            {typeof it === 'object' ? JSON.stringify(it) : String(it)}
          </span>
        ))}
        {items.length > shown.length && (
          <span className="muted">+{items.length - shown.length}</span>
        )}
      </span>
    )
  }

  if (mode === 'detail') {
    return <pre className="json-block">{JSON.stringify(parsed, null, 2)}</pre>
  }

  const compact = JSON.stringify(parsed)
  return (
    <span className="json-inline" title={compact}>
      {compact}
    </span>
  )
}

function ExpandableText({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="expandable">
      {open ? text : `${text.slice(0, 140)}…`}{' '}
      <button type="button" className="link-btn" onClick={() => setOpen(!open)}>
        {open ? 'show less' : 'show more'}
      </button>
    </span>
  )
}
