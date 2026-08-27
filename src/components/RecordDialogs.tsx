import * as React from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { ExternalLink, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'

import { RecordForm } from '~/components/RecordForm'
import { Button } from '~/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogContentSheet,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { deleteEntityRow } from '~/lib/functions'
import { pkFromRow } from '~/lib/pk'
import { entityKeys } from '~/lib/queries'
import type { JsonScalar, TableMeta } from '~/lib/types'

function stop(e: React.SyntheticEvent) {
  e.stopPropagation()
}

export function CreateRowButton({ meta }: { meta: TableMeta }) {
  const [open, setOpen] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> New row
      </Button>
      <DialogContentSheet>
        <DialogHeader>
          <DialogTitle className="font-mono">Insert into {meta.id}</DialogTitle>
          <DialogDescription>
            Generated and identity columns are managed by the database.
          </DialogDescription>
        </DialogHeader>
        <RecordForm
          meta={meta}
          mode="create"
          onDone={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContentSheet>
    </Dialog>
  )
}

export function EditRowButton({
  meta,
  row,
}: {
  meta: TableMeta
  row: Record<string, JsonScalar>
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Pencil /> Edit
      </Button>
      <DialogContentSheet>
        <DialogHeader>
          <DialogTitle className="font-mono">Edit row in {meta.id}</DialogTitle>
          <DialogDescription>
            Primary-key and generated columns are read-only.
          </DialogDescription>
        </DialogHeader>
        <RecordForm
          meta={meta}
          mode="edit"
          initialRow={row}
          onDone={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </DialogContentSheet>
    </Dialog>
  )
}

export function DeleteRowButton({
  meta,
  row,
  onDeleted,
}: {
  meta: TableMeta
  row: Record<string, JsonScalar>
  onDeleted?: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, setIsPending] = React.useState(false)
  const queryClient = useQueryClient()
  const deleteMutation = useMutation({
    mutationFn: () =>
      deleteEntityRow({
        data: { table: meta.id, pk: pkFromRow(meta.columns, row) },
      }),
  })

  function confirmDelete() {
    setError(null)
    setIsPending(true)
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        setIsPending(false)
        void queryClient.invalidateQueries({ queryKey: entityKeys.rows(meta.id) })
        void queryClient.invalidateQueries({ queryKey: entityKeys.list() })
        toast.success('Row deleted')
        setOpen(false)
        onDeleted?.()
      },
      onError: (err) => {
        setIsPending(false)
        setError(err instanceof Error ? err.message : String(err))
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant="outline"
        className="text-destructive hover:bg-destructive/10"
        onClick={() => setOpen(true)}
      >
        <Trash2 /> Delete
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this row?</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {meta.id}
          </DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">
          This permanently deletes the row from the database. This cannot be
          undone.
        </p>
        {error && (
          <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={confirmDelete}
            disabled={isPending}
          >
            {isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Per-row actions kebab for the data table: Open, and (when writes are enabled
 * on a base table) Edit + Delete, each in its own dialog. Clicks are stopped
 * so they don't trigger the surrounding row's navigation.
 */
export function RowActionsMenu({
  meta,
  row,
  writeEnabled,
}: {
  meta: TableMeta
  row: Record<string, JsonScalar>
  writeEnabled: boolean
}) {
  const [editOpen, setEditOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isPending, setIsPending] = React.useState(false)
  const queryClient = useQueryClient()
  const deleteMutation = useMutation({
    mutationFn: () =>
      deleteEntityRow({
        data: { table: meta.id, pk: pkFromRow(meta.columns, row) },
      }),
  })

  const pkFirst = meta.columns.find((c) => c.isPrimaryKey)?.name
  const pkValue = pkFirst ? row[pkFirst] : undefined
  const canOpen = pkFirst != null && pkValue != null && pkValue !== undefined
  const canWrite = writeEnabled && meta.kind === 'table'

  function confirmDelete() {
    setError(null)
    setIsPending(true)
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        setIsPending(false)
        void queryClient.invalidateQueries({ queryKey: entityKeys.rows(meta.id) })
        void queryClient.invalidateQueries({ queryKey: entityKeys.list() })
        toast.success('Row deleted')
        setDeleteOpen(false)
      },
      onError: (err) => {
        setIsPending(false)
        setError(err instanceof Error ? err.message : String(err))
      },
    })
  }

  if (!canOpen && !canWrite) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="Row actions"
            onClick={stop}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={stop}>
          {canOpen && (
            <DropdownMenuItem asChild>
              <Link
                to="/entities/$table/$pk"
                params={{ table: meta.id, pk: String(pkValue) }}
                search={{ pkColumn: pkFirst }}
              >
                <ExternalLink /> Open
              </Link>
            </DropdownMenuItem>
          )}
          {canWrite && (
            <>
              {canOpen && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setDeleteOpen(true)}
              >
                <Trash2 /> Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContentSheet onClick={stop}>
          <DialogHeader>
            <DialogTitle className="font-mono">Edit row in {meta.id}</DialogTitle>
            <DialogDescription>
              Primary-key and generated columns are read-only.
            </DialogDescription>
          </DialogHeader>
          <RecordForm
            meta={meta}
            mode="edit"
            initialRow={row}
            onDone={() => setEditOpen(false)}
            onCancel={() => setEditOpen(false)}
          />
        </DialogContentSheet>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md" onClick={stop}>
          <DialogHeader>
            <DialogTitle>Delete this row?</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {meta.id}
            </DialogDescription>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            This permanently deletes the row from the database. This cannot be
            undone.
          </p>
          {error && (
            <p className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={isPending}>
              {isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
