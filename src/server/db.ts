import pg from 'pg'

import { env } from './env'

declare global {
  // eslint-disable-next-line no-var
  var __pgAdminPool: pg.Pool | undefined
}

export function getPool(): pg.Pool {
  if (!globalThis.__pgAdminPool) {
    const url = env.DATABASE_URL
    console.log('[pg-admin] connecting, prefix:', url.slice(0, 15).replace(/:[^:@]*@/, ':****@'))
    globalThis.__pgAdminPool = new pg.Pool({
      connectionString: url,
      max: 5,
    })
  }
  return globalThis.__pgAdminPool
}
