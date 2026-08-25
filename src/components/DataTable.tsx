import * as React from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Columns3,
  Rows2,
  Rows3,
  Search,
  X,
} from 'lucide-react'

import { CellValue } from '~/components/CellValue'
import { RowActionsMenu } from '~/components/RecordDialogs'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu'
import { Input } from '~/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { cn } from '~/lib/utils'
import type { JsonScalar, TableMeta } from '~/lib/types'

type Row = Record<string, JsonScalar>

const PAGE_SIZES = [25, 50, 100, 200]

export interface DataTableProps {
  meta: TableMeta
  rows: Array<Row>
  writeEnabled: boolean
  /** FK label lookup for the current page (see entityLabelsQuery) */
  fkLabels?: Map<string, string>
  sorting: SortingState
  onSortingChange: (next: SortingState) => void
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  search: string
  onSearchChange: (search: string) => void
  isFetching?: boolean
}

export function DataTable({
  meta,
  rows,
  writeEnabled,
  fkLabels,
  sorting,
  onSortingChange,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  search,
  onSearchChange,
  isFetching = false,
}: DataTableProps) {
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({})
  const [dense, setDense] = React.useState(true)
  const navigate = useNavigate()

  const columns = meta.columns
  const foreignKeys = meta.foreignKeys
  const pkColumn = columns.find((c) => c.isPrimaryKey)?.name

  const columnDefs = React.useMemo<Array<ColumnDef<Row>>>(() => {
    return columns.map((c) => ({
      id: c.name,
      accessorKey: c.name,
      enableSorting: true,
      header: () => (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono">{c.name}</span>
          {c.isPrimaryKey && (
            <Badge variant="secondary" className="px-1 py-0 text-[10px]">
              pk
            </Badge>
          )}
        </span>
      ),
      cell: ({ getValue }) => (
        <CellValue
          value={getValue() as JsonScalar}
          column={c}
          foreignKeys={foreignKeys}
          labels={fkLabels}
        />
      ),
    }))
  }, [columns, foreignKeys, fkLabels])

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    state: { sorting, columnVisibility },
    manualSorting: true,
    manualPagination: true,
    manualFiltering: true,
    enableSortingRemoval: true,
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      onSortingChange(next)
    },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  })

  const firstColId = table.getVisibleLeafColumns()[0]?.id
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  function openRow(row: Row) {
    if (!pkColumn) return
    const pkValue = row[pkColumn]
    if (pkValue === null || pkValue === undefined) return
    navigate({
      to: '/entities/$table/$pk',
      params: { table: meta.id, pk: String(pkValue) },
      search: { pkColumn },
    })
  }

  // sticky helpers so identity + actions stay visible while scrolling wide tables
  const stickyLeft =
    'sticky left-0 z-10 bg-background group-hover:bg-muted/50'
  const stickyRight =
    'sticky right-0 z-10 bg-background group-hover:bg-muted/50'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={search} onChange={onSearchChange} />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDense((d) => !d)}
            title={dense ? 'Comfortable rows' : 'Compact rows'}
          >
            {dense ? <Rows3 /> : <Rows2 />}
            <span className="hidden sm:inline">{dense ? 'Compact' : 'Cozy'}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Columns3 />
                <span className="hidden sm:inline">Columns</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80">
              <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {table.getAllLeafColumns().map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={col.getIsVisible()}
                  onCheckedChange={(v) => col.toggleVisibility(!!v)}
                  onSelect={(e) => e.preventDefault()}
                  className="font-mono text-xs"
                >
                  {col.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div
        className={cn(
          'rounded-lg border transition-opacity',
          isFetching && 'opacity-60',
        )}
      >
        <Table>
          <TableHeader className="bg-muted/40 sticky top-0 z-20">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const sortDir = header.column.getIsSorted()
                  const isFirst = header.column.id === firstColId
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        isFirst && 'sticky left-0 z-30 bg-muted/40',
                      )}
                    >
                      <button
                        type="button"
                        className="hover:text-foreground -ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {sortDir === 'asc' ? (
                          <ArrowUp className="size-3.5" />
                        ) : sortDir === 'desc' ? (
                          <ArrowDown className="size-3.5" />
                        ) : (
                          <ChevronsUpDown className="size-3.5 opacity-40" />
                        )}
                      </button>
                    </TableHead>
                  )
                })}
                <TableHead className="sticky right-0 z-30 w-10 bg-muted/40" />
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length + 1}
                  className="text-muted-foreground h-24 text-center"
                >
                  {search ? 'No rows match your search.' : 'No rows found.'}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={cn('group', pkColumn && 'cursor-pointer')}
                  onClick={() => openRow(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        'max-w-[28rem] truncate',
                        dense && 'py-1.5',
                        cell.column.id === firstColId && stickyLeft,
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                  <TableCell className={cn('w-10 text-right', dense && 'py-1', stickyRight)}>
                    <RowActionsMenu
                      meta={meta}
                      row={row.original}
                      writeEnabled={writeEnabled}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="text-muted-foreground">
          {total > 0 ? (
            <>
              <span className="text-foreground font-medium">
                {from.toLocaleString()}–{to.toLocaleString()}
              </span>{' '}
              of{' '}
              <span className="text-foreground font-medium">
                {total.toLocaleString()}
              </span>{' '}
              rows
            </>
          ) : (
            '0 rows'
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground hidden sm:inline">
              Rows per page
            </span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => onPageSizeChange(Number(v))}
            >
              <SelectTrigger size="sm" className="w-[4.5rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground tabular-nums">
              Page {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SearchBox({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [local, setLocal] = React.useState(value)

  React.useEffect(() => {
    setLocal(value)
  }, [value])

  React.useEffect(() => {
    if (local === value) return
    const id = setTimeout(() => onChange(local), 300)
    return () => clearTimeout(id)
  }, [local, value, onChange])

  return (
    <div className="relative w-full max-w-xs">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
      <Input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder="Search rows…"
        className="pr-8 pl-8"
      />
      {local && (
        <button
          type="button"
          onClick={() => setLocal('')}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
          aria-label="Clear search"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
