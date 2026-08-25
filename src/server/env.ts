import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { z } from 'zod'

/**
 * TanStack Start's SSR module runner does not reliably expose .env via
 * process.env, so read the file directly with a minimal line parser
 * (no dependency quirks). Real environment variables win when valid.
 */
function loadRawEnv(): { DATABASE_URL: string; PGSCHEMA?: string | undefined } {
  const fileEnv: Record<string, string> = {}
  try {
    const content = readFileSync(resolve(process.cwd(), '.env'), 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim()
      if (key) fileEnv[key] = value
    }
  } catch {
    // no .env file — rely on process.env
  }

  const isValidUrl = (v: string | undefined): v is string =>
    !!v &&
    v.length > 11 &&
    (v.startsWith('postgres://') || v.startsWith('postgresql://'))

  // A placeholder process env (e.g. "postgres://") must not shadow the file.
  const url = isValidUrl(process.env.DATABASE_URL)
    ? process.env.DATABASE_URL
    : (fileEnv.DATABASE_URL ?? '')

  return {
    DATABASE_URL: url,
    PGSCHEMA: process.env.PGSCHEMA ?? fileEnv.PGSCHEMA,
  }
}

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .min(1)
    .transform((v) => v.trim().replace(/^['"]|['"]$/g, ''))
    .refine(
      (v) => v.startsWith('postgres://') || v.startsWith('postgresql://'),
      'DATABASE_URL must be a postgres:// or postgresql:// connection string',
    ),
  /**
   * Optional comma-separated schema allowlist.
   * Unset/empty => all non-system schemas in the database.
   */
  PGSCHEMA: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

function validateEnv(): Env {
  const raw = loadRawEnv()
  const parsed = envSchema.safeParse(raw)
  if (!parsed.success) {
    console.error('Invalid environment configuration:')
    console.error(z.treeifyError(parsed.error))
    console.error('process.cwd():', process.cwd())
    console.error('process.env len:', (process.env.DATABASE_URL ?? '').length)
    console.error('resolved len:', raw.DATABASE_URL.length)
    throw new Error(
      `Invalid DATABASE_URL (length ${raw.DATABASE_URL.length}). Set a postgres:// connection string in .env.`,
    )
  }
  return parsed.data
}

export const env = validateEnv()
