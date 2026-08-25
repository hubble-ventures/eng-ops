import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { z } from 'zod'

/**
 * TanStack Start's SSR module runner does not reliably expose .env via
 * process.env, so read the file directly with a minimal line parser
 * (no dependency quirks). Real environment variables win when valid.
 */
function loadRawEnv(): {
  DATABASE_URL: string
  PGSCHEMA?: string | undefined
  PGSSLMODE?: string | undefined
  PGSSLROOTCERT?: string | undefined
  ENGOPS_CONFIG?: string | undefined
  ENGOPS_COLUMN_ORDER?: string | undefined
  ENGOPS_WRITE?: string | undefined
} {
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

  // For non-secret settings a real env var wins, else the .env file value.
  const pick = (key: string): string | undefined =>
    process.env[key] ?? fileEnv[key]

  return {
    DATABASE_URL: url,
    PGSCHEMA: pick('PGSCHEMA'),
    PGSSLMODE: pick('PGSSLMODE'),
    PGSSLROOTCERT: pick('PGSSLROOTCERT'),
    ENGOPS_CONFIG: pick('ENGOPS_CONFIG'),
    ENGOPS_COLUMN_ORDER: pick('ENGOPS_COLUMN_ORDER'),
    ENGOPS_WRITE: pick('ENGOPS_WRITE'),
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
  /**
   * TLS mode for the connection, libpq-style. Unset => defer to the
   * connection string's own `sslmode` (fine for local, unencrypted DBs).
   * - disable    : never use TLS
   * - require / no-verify : encrypt but do not verify the server cert
   * - verify-ca / verify-full : encrypt and verify (optionally against
   *   PGSSLROOTCERT)
   */
  PGSSLMODE: z
    .enum(['disable', 'require', 'no-verify', 'verify-ca', 'verify-full'])
    .optional(),
  /** Path to a CA cert PEM used when PGSSLMODE is verify-ca/verify-full. */
  PGSSLROOTCERT: z.string().optional(),
  /** Path to an optional JSON config file (default: ./engops.config.json). */
  ENGOPS_CONFIG: z.string().optional(),
  /** Global column-ordering strategy; overrides the config file's default. */
  ENGOPS_COLUMN_ORDER: z.enum(['natural', 'smart']).optional(),
  /**
   * Enable write operations (create/update/delete). Off by default — the app
   * is a read-only browser unless this is explicitly turned on, and the DB
   * role must actually have write privileges. Accepts "1" or "true".
   */
  ENGOPS_WRITE: z
    .string()
    .optional()
    .transform((v) => v === '1' || v?.toLowerCase() === 'true'),
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
