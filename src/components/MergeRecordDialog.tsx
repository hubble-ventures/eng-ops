import * as React from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  GitMerge,
  Info,
  Loader2,
  Radar,
  Search,
  X,
} from 'lucide-react'

import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContentSheet,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Skeleton } from '~/components/ui/skeleton'
import { mergeEntityRows, scanUndeclaredRefs } from '~/lib/functions'
import { entityKeys, entityRowsQuery, mergePlanQuery } from '~/lib/queries'
import type { JsonScalar, MergePlan, ScanResult, TableMeta } from '~/lib/types'

/**
 * "Merge this record into another": the record on screen is the one being
 * merged *away*, and the operator picks the row that survives.
 *
 * The dialog never resolves anything on the operator's behalf. It shows what
 * would move, what would be dropped as an exact duplicate, what blocks the
 * merge (with links straight to the rows to fix), and what the tool cannot see
 * — and only then offers the button.
 */
export function MergeRecordButton({
  meta,
  row,
  pkColumn,
}: {
  meta: TableMeta
  row: Record<string, JsonScalar>
  pkColumn: string
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <GitMerge /> Merge
      </Button>
      <DialogContentSheet className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono">Merge a row of {meta.id}</DialogTitle>
          <DialogDescription>
            Every row that references this one is reassigned to the row you pick,
            and this one is then retired. One transaction; nothing is applied
            until you confirm.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <MergeBody
            meta={meta}
            row={row}
            pkColumn={pkColumn}
            onDone={() => setOpen(false)}
          />
        )}
      </DialogContentSheet>
    </Dialog>
  )
}

/**
 * Same hint order as the server's `pickDisplayColumn`, so a row reads the same
 * in the picker as it does in the plan. The hint list wins over the table's own
 * column order — otherwise a configured column order would silently change
 * which column labels a row.
 */
const LABEL_HINTS = [
  'name',
  'title',
  'label',
  'display_name',
  'full_name',
  'email',
  'slug',
  'username',
  'code',
]

function displayLabel(meta: TableMeta, row: Record<string, JsonScalar>): string {
  for (const hint of LABEL_HINTS) {
    const column = meta.columns.find(
      (c) => !c.isPrimaryKey && c.name.toLowerCase() === hint,
    )
    const value = column ? row[column.name] : null
    if (value !== null && value !== undefined && value !== '') return String(value)
  }
  return ''
}

function MergeBody({
  meta,
  row,
  pkColumn,
  onDone,
}: {
  meta: TableMeta
  row: Record<string, JsonScalar>
  pkColumn: string
  onDone: () => void
}) {
  const loserPk = String(row[pkColumn] ?? '')
  const [keeperPk, setKeeperPk] = React.useState<string | null>(null)
  const [acknowledged, setAcknowledged] = React.useState(false)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const planQuery = useQuery(mergePlanQuery(meta.id, keeperPk, loserPk))
  const plan = planQuery.data
  const blocked = !plan || plan.blocks.length > 0

  const merge = useMutation({
    mutationFn: async () => {
      if (!plan || !keeperPk) throw new Error('Pick a row to merge into first.')
      return await mergeEntityRows({
        data: {
          table: meta.id,
          keeperPk,
          loserPk,
          signature: plan.signature,
        },
      })
    },
    onSuccess: (result) => {
      toast.success(
        `Merged ${loserPk} into ${result.keeperPk}: ${result.rowsMoved} row(s) reassigned, ${result.rowsDropped} duplicate(s) dropped, ${
          result.disposition === 'tombstone' ? 'loser tombstoned' : 'loser deleted'
        }.`,
      )
      void queryClient.invalidateQueries({ queryKey: entityKeys.all })
      onDone()
      void navigate({
        to: '/entities/$table/$pk',
        params: { table: meta.id, pk: result.keeperPk },
        search: { pkColumn },
      })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The plan can run long; the confirmation must never scroll out of reach. */}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Merge away</h3>
        <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 font-mono text-sm">
          <Badge variant="secondary">{pkColumn}</Badge>
          <span>{loserPk}</span>
          <span className="text-muted-foreground truncate">
            {displayLabel(meta, row)}
          </span>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">
          Keep <span className="text-muted-foreground font-normal">— the row that survives</span>
        </h3>
        {keeperPk ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 font-mono text-sm">
            <Check className="text-primary size-4" />
            <Badge variant="secondary">{pkColumn}</Badge>
            <span>{keeperPk}</span>
            <span className="text-muted-foreground truncate">
              {plan?.keeperLabel ?? ''}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => {
                setKeeperPk(null)
                setAcknowledged(false)
              }}
            >
              <X /> Change
            </Button>
          </div>
        ) : (
          <KeeperPicker
            meta={meta}
            pkColumn={pkColumn}
            excludePk={loserPk}
            onPick={setKeeperPk}
          />
        )}
      </section>

      {keeperPk && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Plan</h3>
          {planQuery.isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-2/3" />
            </div>
          ) : planQuery.isError ? (
            <p className="text-destructive text-sm">
              {(planQuery.error as Error).message}
            </p>
          ) : plan ? (
            <PlanView plan={plan} pkColumn={pkColumn} />
          ) : null}
        </section>
      )}

      {plan && plan.blocks.length === 0 && (
        <UndeclaredScan table={meta.id} pkValue={loserPk} />
      )}

      {plan && plan.blocks.length === 0 && (
        <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span>
            I understand this reassigns only the references listed above, and that
            references without a declared constraint are invisible to this tool.
          </span>
        </label>
      )}

      </div>

      <div className="mt-4 flex justify-end gap-2 border-t pt-4">
        <Button variant="outline" onClick={onDone} disabled={merge.isPending}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={blocked || !acknowledged || merge.isPending}
          onClick={() => merge.mutate()}
        >
          {merge.isPending ? <Loader2 className="animate-spin" /> : <GitMerge />}
          {!plan
            ? 'Merge'
            : plan.disposition === 'tombstone'
              ? `Merge and stamp ${plan.tombstoneColumn}`
              : 'Merge and delete'}
        </Button>
      </div>
    </div>
  )
}

const PICKER_LIMIT = 8

function KeeperPicker({
  meta,
  pkColumn,
  excludePk,
  onPick,
}: {
  meta: TableMeta
  pkColumn: string
  excludePk: string
  onPick: (pk: string) => void
}) {
  const [search, setSearch] = React.useState('')
  const [debounced, setDebounced] = React.useState('')
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 200)
    return () => clearTimeout(id)
  }, [search])

  const rowsQuery = useQuery(
    entityRowsQuery(meta.id, {
      limit: PICKER_LIMIT + 1,
      offset: 0,
      search: debounced || undefined,
      orderBy: pkColumn,
      orderDir: 'asc',
    }),
  )
  const candidates = (rowsQuery.data?.rows ?? [])
    .filter((r) => String(r[pkColumn] ?? '') !== excludePk)
    .slice(0, PICKER_LIMIT)

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`Search ${meta.id}…`}
          className="pl-8"
        />
      </div>
      <div className="divide-y rounded-md border">
        {rowsQuery.isPending ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : candidates.length === 0 ? (
          <p className="text-muted-foreground p-3 text-sm">No other rows match.</p>
        ) : (
          candidates.map((candidate) => {
            const pk = String(candidate[pkColumn] ?? '')
            return (
              <button
                key={pk}
                type="button"
                onClick={() => onPick(pk)}
                className="hover:bg-accent flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
              >
                <Badge variant="secondary" className="font-mono">
                  {pk}
                </Badge>
                <span className="truncate">{displayLabel(meta, candidate)}</span>
                <ArrowRight className="ml-auto size-3.5 shrink-0 opacity-50" />
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function PlanView({ plan, pkColumn }: { plan: MergePlan; pkColumn: string }) {
  return (
    <div className="space-y-4">
      {plan.blocks.length > 0 && (
        <div className="border-destructive/40 bg-destructive/5 space-y-3 rounded-md border p-3">
          <p className="text-destructive flex items-center gap-1.5 text-sm font-semibold">
            <AlertTriangle className="size-4" />
            {plan.blocks.length} block{plan.blocks.length === 1 ? '' : 's'} — nothing
            will be changed
          </p>
          {plan.blocks.map((block, i) => (
            <div key={`${block.code}-${i}`} className="space-y-1.5 text-sm">
              <p>{block.message}</p>
              {block.rows && block.rows.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {block.rows.map((ref, j) =>
                    ref.pkColumn && ref.pkValue ? (
                      <Link
                        key={`${ref.table}-${ref.pkValue}-${j}`}
                        to="/entities/$table/$pk"
                        params={{ table: ref.table, pk: ref.pkValue }}
                        search={{ pkColumn: ref.pkColumn }}
                        target="_blank"
                      >
                        <Badge
                          variant="outline"
                          className="hover:bg-accent gap-1 font-mono"
                        >
                          {ref.table} / {ref.pkValue}
                          <ArrowRight className="size-3 opacity-60" />
                        </Badge>
                      </Link>
                    ) : null,
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {plan.blocks.length === 0 && (
        <>
          <PlanTable
            title={`Reassign — ${plan.totalRowsMoved} row${plan.totalRowsMoved === 1 ? '' : 's'}`}
            empty="Nothing references this row."
            rows={plan.moves.map((m) => ({
              key: `${m.table}.${m.column}`,
              label: `${m.table}.${m.column}`,
              count: m.rows,
              note: m.enforced
                ? `ON DELETE ${m.onDelete ?? 'no action'}`
                : 'declared in config — no constraint',
            }))}
          />
          <PlanTable
            title={`Drop as duplicate — ${plan.totalRowsDropped} row${plan.totalRowsDropped === 1 ? '' : 's'}`}
            empty="No duplicate rows."
            rows={plan.duplicates.map((d) => ({
              key: `${d.table}.${d.column}.${d.scope}`,
              label: `${d.table}.${d.column}`,
              count: d.rows,
              note: `identical under ${d.scope}`,
            }))}
          />
          <div className="rounded-md border p-3 text-sm">
            <span className="font-semibold">Then retire </span>
            <code className="font-mono">
              {plan.table} / {plan.loserPk}
            </code>{' '}
            {plan.disposition === 'tombstone' ? (
              <>
                by setting <code className="font-mono">{plan.tombstoneColumn}</code>{' '}
                to now().
              </>
            ) : (
              <>
                by deleting it — {plan.table} has no soft-delete column. The deleted
                row is returned in full so it is on the record.
              </>
            )}{' '}
            <span className="text-muted-foreground">
              The transaction first asserts that nothing anywhere still references{' '}
              {pkColumn} = {plan.loserPk}, and rolls back if anything does.
            </span>
          </div>
        </>
      )}

      {plan.warnings.length > 0 && (
        <div className="space-y-2 rounded-md border p-3">
          {plan.warnings.map((w) => (
            <p
              key={w.code}
              className="text-muted-foreground flex gap-2 text-xs leading-relaxed"
            >
              <Info className="mt-0.5 size-3.5 shrink-0" />
              <span>{w.message}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function PlanTable({
  title,
  empty,
  rows,
}: {
  title: string
  empty: string
  rows: Array<{ key: string; label: string; count: number; note: string }>
}) {
  return (
    <div className="rounded-md border">
      <p className="bg-muted/40 border-b px-3 py-1.5 text-sm font-semibold">{title}</p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground px-3 py-2 text-sm">{empty}</p>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.key} className="flex items-baseline gap-2 px-3 py-1.5 text-sm">
              <code className="font-mono">{r.label}</code>
              <span className="text-muted-foreground text-xs">{r.note}</span>
              <span className="ml-auto tabular-nums">{r.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * On-demand hunt for references nothing declares.
 *
 * Deliberately a button rather than part of the plan: it reads every candidate
 * table, which is far too expensive to do on every keystroke of a row picker.
 * The operator asks for it, once, before committing.
 */
function UndeclaredScan({ table, pkValue }: { table: string; pkValue: string }) {
  const scan = useMutation({
    mutationFn: async (): Promise<ScanResult> =>
      await scanUndeclaredRefs({ data: { table, pkValue } }),
    onError: (error: Error) => toast.error(error.message),
  })
  const result = scan.data

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Undeclared references</p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => scan.mutate()}
          disabled={scan.isPending}
        >
          {scan.isPending ? <Loader2 className="animate-spin" /> : <Radar />}
          {result ? 'Scan again' : 'Scan for undeclared references'}
        </Button>
      </div>

      {!result && !scan.isPending && (
        <p className="text-muted-foreground text-xs leading-relaxed">
          Checks every table for columns that hold this row&apos;s id but have no
          foreign key and no config entry — the references a merge cannot see, and
          would leave pointing at a retired id. Reads each candidate table once,
          so run it when you are ready to commit rather than while browsing.
        </p>
      )}

      {result && (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground text-xs">
            Scanned {result.columnsScanned} column
            {result.columnsScanned === 1 ? '' : 's'} across {result.tablesScanned}{' '}
            table{result.tablesScanned === 1 ? '' : 's'} of type {result.pkType} in{' '}
            {result.elapsedMs}ms. Columns with any foreign key, primary keys, and
            views are not candidates.
          </p>

          {result.hits.length === 0 ? (
            <p className="flex items-center gap-1.5">
              <Check className="text-primary size-4" />
              Nothing outside the declared edges holds this id.
            </p>
          ) : (
            <>
              <ul className="divide-y rounded-md border">
                {result.hits.map((hit) => (
                  <li
                    key={`${hit.table}.${hit.column}`}
                    className="flex flex-wrap items-baseline gap-2 px-3 py-1.5"
                  >
                    <code className="font-mono">
                      {hit.table}.{hit.column}
                    </code>
                    <Badge
                      variant={hit.confidence === 'strong' ? 'destructive' : 'secondary'}
                    >
                      {hit.confidence === 'strong' ? 'likely a reference' : 'check by hand'}
                    </Badge>
                    <span className="ml-auto tabular-nums">{hit.rows}</span>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground text-xs leading-relaxed">
                {result.hits.some((h) => h.confidence === 'weak')
                  ? `${result.pkType} ids collide with ordinary numbers, so a match here is a candidate to eyeball, not proof. `
                  : ''}
                A column that really does reference {result.table} will not be moved
                by this merge unless you declare it. Add it to
                engops.config.json and restart the server:
              </p>
              {result.suggestedConfig && (
                <pre className="bg-muted/40 overflow-x-auto rounded-md p-2 text-xs">
                  <code>{result.suggestedConfig}</code>
                </pre>
              )}
            </>
          )}

          {result.skipped.length > 0 && (
            <div className="border-destructive/40 bg-destructive/5 rounded-md border p-2 text-xs">
              <p className="font-semibold">
                {result.skipped.length} table
                {result.skipped.length === 1 ? '' : 's'} could not be scanned — this
                result is incomplete:
              </p>
              <ul className="mt-1 space-y-0.5">
                {result.skipped.map((skip) => (
                  <li key={skip.table}>
                    <code className="font-mono">{skip.table}</code> ({skip.reason})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
