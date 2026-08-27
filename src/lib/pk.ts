import type { ColumnMeta, JsonScalar } from '~/lib/types'

/** Build the primary-key map (column → value) for a row from its metadata. */
export function pkFromRow(
  columns: Array<ColumnMeta>,
  row: Record<string, JsonScalar>,
): Record<string, JsonScalar> {
  const pk: Record<string, JsonScalar> = {}
  for (const c of columns) {
    if (c.isPrimaryKey) pk[c.name] = row[c.name] ?? null
  }
  return pk
}
