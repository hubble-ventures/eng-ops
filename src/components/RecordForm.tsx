import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import { Textarea } from '~/components/ui/textarea'
import { createEntityRow, updateEntityRow } from '~/lib/functions'
import { pkFromRow } from '~/lib/pk'
import { entityKeys } from '~/lib/queries'
import { cn } from '~/lib/utils'
import type { ColumnMeta, JsonScalar, TableMeta } from '~/lib/types'

type FieldValue = string | boolean | null
type Values = Record<string, FieldValue>

const NUMERIC = new Set(['int2', 'int4', 'int8', 'numeric', 'float4', 'float8'])
const JSON_TYPES = new Set(['json', 'jsonb'])
const LONG_TEXT_HINT =
  /(bio|description|desc|notes?|content|body|comment|summary|address|message|about)/i

/** A serial/sequence-backed column — auto-filled by the DB, hide on insert. */
function isSequenceDefault(col: ColumnMeta): boolean {
  return col.defaultExpr?.startsWith('nextval(') ?? false
}

function isReadOnly(col: ColumnMeta, mode: 'create' | 'edit'): boolean {
  if (col.isGenerated) return true
  if (mode === 'edit' && col.isPrimaryKey) return true
  return false
}

/** Columns shown in the form for the given mode. */
function formColumns(meta: TableMeta, mode: 'create' | 'edit'): Array<ColumnMeta> {
  return meta.columns.filter((c) => {
    if (c.isGenerated) return mode === 'edit' // read-only in edit, hidden on create
    if (mode === 'create' && (c.isIdentity || isSequenceDefault(c))) return false
    return true
  })
}

/** Whether the field is genuinely required (no null, no usable default). */
function isRequired(col: ColumnMeta): boolean {
  return !col.nullable && !col.hasDefault
}

/** Parse a simple column default into a form value, else undefined (server fills it). */
function parseDefault(col: ColumnMeta): FieldValue | undefined {
  const d = col.defaultExpr
  if (!d) return undefined
  if (col.udtName === 'bool') {
    if (d.startsWith('true')) return true
    if (d.startsWith('false')) return false
    return undefined
  }
  const literal = d.match(/^'((?:[^']|'')*)'::/) // 'value'::type
  if (literal && literal[1] !== undefined) return literal[1].replace(/''/g, "'")
  if (/^-?\d+(\.\d+)?$/.test(d)) return d // bare numeric literal
  return undefined // now(), gen_random_uuid(), etc. — let the DB apply it
}

function initialValues(
  columns: Array<ColumnMeta>,
  mode: 'create' | 'edit',
  initialRow: Record<string, JsonScalar> | undefined,
): Values {
  const v: Values = {}
  for (const c of columns) {
    if (mode === 'edit') {
      const raw = initialRow?.[c.name]
      v[c.name] =
        c.udtName === 'bool'
          ? raw === null || raw === undefined
            ? false
            : Boolean(raw)
          : raw === null || raw === undefined
            ? ''
            : String(raw)
      continue
    }
    // create: seed from the column default when we can parse it
    const def = parseDefault(c)
    if (def !== undefined) v[c.name] = def
    else v[c.name] = c.udtName === 'bool' ? false : ''
  }
  return v
}

export function RecordForm({
  meta,
  mode,
  initialRow,
  onDone,
  onCancel,
}: {
  meta: TableMeta
  mode: 'create' | 'edit'
  initialRow?: Record<string, JsonScalar>
  onDone: () => void
  onCancel: () => void
}) {
  const columns = React.useMemo(() => formColumns(meta, mode), [meta, mode])
  const [values, setValues] = React.useState<Values>(() =>
    initialValues(columns, mode, initialRow),
  )
  const [error, setError] = React.useState<string | null>(null)
  const [pending, setPending] = React.useState(false)

  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, JsonScalar>) =>
      createEntityRow({ data: { table: meta.id, data: payload } }),
  })
  const updateMutation = useMutation({
    mutationFn: (vars: {
      pk: Record<string, JsonScalar>
      patch: Record<string, JsonScalar>
    }) =>
      updateEntityRow({
        data: { table: meta.id, pk: vars.pk, patch: vars.patch },
      }),
  })

  const fkByColumn = React.useMemo(
    () => new Map(meta.foreignKeys.map((f) => [f.column, f])),
    [meta],
  )

  function set(name: string, value: FieldValue) {
    setValues((prev) => ({ ...prev, [name]: value }))
  }

  function buildPayload(): Record<string, JsonScalar> {
    const payload: Record<string, JsonScalar> = {}
    for (const c of columns) {
      if (isReadOnly(c, mode)) continue
      const value = values[c.name] ?? null
      if (typeof value === 'boolean') {
        payload[c.name] = value
        continue
      }
      if (value === '' || value === null) {
        if (mode === 'create' && c.hasDefault) continue // let the DB default apply
        payload[c.name] = null
        continue
      }
      payload[c.name] = value
    }
    return payload
  }

  function firstMissingRequired(): string | null {
    for (const c of columns) {
      if (isReadOnly(c, mode)) continue
      if (!isRequired(c)) continue
      const v = values[c.name]
      if (v === '' || v === null || v === undefined) return c.name
    }
    return null
  }

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: entityKeys.rows(meta.id) })
    void queryClient.invalidateQueries({ queryKey: entityKeys.list() })
    if (mode === 'edit') {
      void queryClient.invalidateQueries({ queryKey: entityKeys.all })
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const missing = firstMissingRequired()
    if (missing) {
      setError(`"${missing}" is required.`)
      return
    }
    setPending(true)
    const payload = buildPayload()
    const onError = (err: unknown) => {
      setPending(false)
      setError(err instanceof Error ? err.message : String(err))
    }
    const onSuccess = () => {
      setPending(false)
      invalidate()
      toast.success(mode === 'create' ? 'Row created' : 'Row updated')
      onDone()
    }

    if (mode === 'create') {
      createMutation.mutate(payload, { onSuccess, onError })
    } else {
      const pk = pkFromRow(meta.columns, initialRow ?? {})
      updateMutation.mutate({ pk, patch: payload }, { onSuccess, onError })
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-col gap-4">
      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pr-1">
        {columns.map((c) => (
          <Field
            key={c.name}
            column={c}
            value={values[c.name] ?? null}
            readOnly={isReadOnly(c, mode)}
            fkTarget={fkByColumn.get(c.name)?.referencedTable}
            onChange={(v) => set(c.name, v)}
          />
        ))}
      </div>

      {error && (
        <p className="border-destructive/40 bg-destructive/10 text-destructive shrink-0 rounded-md border px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <div className="flex shrink-0 justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : mode === 'create' ? 'Create' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}

function Field({
  column,
  value,
  readOnly,
  fkTarget,
  onChange,
}: {
  column: ColumnMeta
  value: FieldValue
  readOnly: boolean
  fkTarget: string | undefined
  onChange: (v: FieldValue) => void
}) {
  const id = `f_${column.name}`
  const required = isRequired(column)
  const hint = [
    column.dataType,
    required ? null : column.nullable ? 'nullable' : 'has default',
    fkTarget ? `→ ${fkTarget}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="font-mono text-xs">
        {column.name}
        {required && <span className="text-destructive">*</span>}
        {column.isPrimaryKey && (
          <span className="text-muted-foreground font-normal">(pk)</span>
        )}
      </Label>
      <FieldInput
        id={id}
        column={column}
        value={value}
        readOnly={readOnly}
        onChange={onChange}
      />
      <span className="text-muted-foreground text-[11px]">{hint}</span>
    </div>
  )
}

function FieldInput({
  id,
  column,
  value,
  readOnly,
  onChange,
}: {
  id: string
  column: ColumnMeta
  value: FieldValue
  readOnly: boolean
  onChange: (v: FieldValue) => void
}) {
  if (column.udtName === 'bool') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <input
          id={id}
          type="checkbox"
          className="size-4"
          checked={value === true}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.checked)}
        />
        {value ? 'true' : 'false'}
      </label>
    )
  }

  if (column.enumValues && column.enumValues.length > 0) {
    return (
      <Select
        value={typeof value === 'string' ? value : ''}
        onValueChange={(v) => onChange(v)}
        disabled={readOnly}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="(none)" />
        </SelectTrigger>
        <SelectContent>
          {column.enumValues.map((label) => (
            <SelectItem key={label} value={label}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  const strValue = typeof value === 'string' ? value : ''

  const isLong =
    JSON_TYPES.has(column.udtName) ||
    ((column.udtName === 'text' || column.udtName === 'varchar') &&
      (column.maxLength === null || column.maxLength > 255) &&
      LONG_TEXT_HINT.test(column.name))
  if (isLong) {
    return (
      <Textarea
        id={id}
        value={strValue}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={cn(JSON_TYPES.has(column.udtName) && 'font-mono text-xs')}
        placeholder={JSON_TYPES.has(column.udtName) ? '{ }' : undefined}
      />
    )
  }

  let type = 'text'
  if (NUMERIC.has(column.udtName)) type = 'number'
  else if (column.udtName === 'date') type = 'date'
  else if (/(^|_)email$/i.test(column.name)) type = 'email'

  return (
    <Input
      id={id}
      type={type}
      value={strValue}
      readOnly={readOnly}
      maxLength={column.maxLength ?? undefined}
      onChange={(e) => onChange(e.target.value)}
      className={cn(readOnly && 'opacity-60')}
    />
  )
}
