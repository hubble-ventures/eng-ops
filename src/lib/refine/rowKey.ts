import type { ColumnMeta, JsonScalar } from '~/lib/types'

/**
 * Refine models a record by a single `id`. Our rows can have composite primary
 * keys, so we encode the full primary-key map as a stable JSON string and use
 * that as the Refine id. The data provider decodes it back into a column→value
 * map for the WHERE clause.
 */
export function encodeRowId(pk: Record<string, JsonScalar>): string {
  return JSON.stringify(pk)
}

export function decodeRowId(id: string | number): Record<string, JsonScalar> {
  if (typeof id === 'number') return { id }
  try {
    const parsed = JSON.parse(id)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, JsonScalar>
    }
  } catch {
    // not JSON — fall through
  }
  return { id }
}

/** Build the primary-key map for a row from its column metadata. */
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
