import { readFileSync } from 'node:fs'

import pg from 'pg'

import { env } from './env'

declare global {
  // eslint-disable-next-line no-var
  var __engOpsPool: pg.Pool | undefined
}

/**
 * Translate PGSSLMODE (libpq-style) into node-postgres `ssl` config.
 * Returns undefined when unset so the connection string's own `sslmode`
 * still applies — the right default for local, unencrypted databases.
 */
function resolveSsl(): pg.PoolConfig['ssl'] {
  const mode = env.PGSSLMODE
  if (!mode || mode === 'disable') return undefined
  if (mode === 'require' || mode === 'no-verify') {
    // encrypt, but don't verify the server certificate
    return { rejectUnauthorized: false }
  }
  // verify-ca / verify-full: verify, optionally against a provided CA
  const ca = env.PGSSLROOTCERT
    ? readFileSync(env.PGSSLROOTCERT, 'utf8')
    : undefined
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) }
}

export function getPool(): pg.Pool {
  if (!globalThis.__engOpsPool) {
    const url = env.DATABASE_URL
    const ssl = resolveSsl()
    console.log(
      '[eng-ops] connecting, prefix:',
      url.slice(0, 15).replace(/:[^:@]*@/, ':****@'),
      ssl ? '(ssl)' : '',
    )
    globalThis.__engOpsPool = new pg.Pool({
      connectionString: url,
      max: 5,
      ...(ssl ? { ssl } : {}),
    })
  }
  return globalThis.__engOpsPool
}
