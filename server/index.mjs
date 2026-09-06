/**
 * Production HTTP server for eng-ops.
 *
 * `vite build` emits a *fetch handler* (`dist/server/server.js`) and a bag of
 * hashed client assets (`dist/client/assets`) — not a listening server. This
 * module is the missing piece: it binds a port, serves the built assets, adds
 * health probes, and delegates everything else to the SSR handler. Every way
 * of running eng-ops (npx, container, sidecar) goes through here, so the
 * runtime behaviour is identical in all of them.
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, normalize, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import { serve } from 'srvx'

/** Package root — this file lives at <root>/server/index.mjs. */
export const packageRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

export const CLIENT_DIR = join(packageRoot, 'dist', 'client')
export const SERVER_ENTRY = join(packageRoot, 'dist', 'server', 'server.js')

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/vnd.microsoft.icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
}

function contentType(path) {
  const dot = path.lastIndexOf('.')
  return (dot === -1 ? undefined : MIME[path.slice(dot).toLowerCase()]) ?? 'application/octet-stream'
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Serve files from `dist/client`. Vite fingerprints everything under
 * `/assets/`, so those are immutable; anything else must be revalidated.
 * Unknown paths fall through to the SSR handler (that's how routes work).
 */
function staticFiles(dir) {
  const root = resolve(dir) + sep
  return async (request, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next()

    const pathname = decodeURIComponent(new URL(request.url).pathname)
    if (pathname === '/' || pathname.endsWith('/')) return next()

    // normalize() collapses `..`; the prefix check is the actual guard.
    const filePath = join(root, normalize(pathname).replace(/^([/\\])+/, ''))
    if (!filePath.startsWith(root)) return next()

    const info = await stat(filePath).catch(() => null)
    if (!info?.isFile()) return next()

    const headers = {
      'content-type': contentType(filePath),
      'content-length': String(info.size),
      'last-modified': info.mtime.toUTCString(),
      'cache-control': pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=0, must-revalidate',
    }
    if (request.method === 'HEAD') return new Response(null, { headers })
    return new Response(Readable.toWeb(createReadStream(filePath)), { headers })
  }
}

/**
 * Liveness (`/healthz`) never touches the database: it answers "is this
 * process still serving?". Readiness (`/readyz`) runs `SELECT 1` so an
 * orchestrator can hold traffic back while Postgres is unreachable. The
 * result is cached briefly so a chatty probe interval can't exhaust the pool.
 */
function healthProbes({ readyTtlMs = 2000, connectTimeoutMs = 3000 } = {}) {
  let pool
  let cached = { at: 0, ok: false, error: null }

  async function checkDatabase() {
    if (Date.now() - cached.at < readyTtlMs) return cached
    // Without an explicit URL, pg would silently fall back to PG* defaults and
    // report a *different* database as healthy.
    if (!process.env.DATABASE_URL) {
      return { at: Date.now(), ok: false, error: 'DATABASE_URL is not set' }
    }
    const pg = (await import('pg')).default
    pool ??= new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: connectTimeoutMs,
      idleTimeoutMillis: 10_000,
      // Don't let an idle probe connection hold the process open during a
      // graceful shutdown — container stops should be fast.
      allowExitOnIdle: true,
    })
    try {
      await pool.query('select 1')
      cached = { at: Date.now(), ok: true, error: null }
    } catch (error) {
      cached = { at: Date.now(), ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    return cached
  }

  return async (request, next) => {
    const { pathname } = new URL(request.url)
    if (pathname === '/healthz') return json({ status: 'ok' })
    if (pathname !== '/readyz') return next()

    const result = await checkDatabase()
    return result.ok
      ? json({ status: 'ok', database: 'reachable' })
      : json({ status: 'unavailable', database: 'unreachable', error: result.error }, 503)
  }
}

/**
 * Start the server. Resolves once it is listening.
 *
 * The SSR bundle validates DATABASE_URL at import time, so it is imported
 * lazily — callers get a chance to run their own preflight first.
 */
export async function startServer({ port, hostname, silent = false } = {}) {
  const { default: handler } = await import(SERVER_ENTRY)

  const server = serve({
    port: port ?? process.env.PORT ?? 3000,
    hostname: hostname ?? process.env.HOST ?? '127.0.0.1',
    silent: true,
    middleware: [healthProbes(), staticFiles(CLIENT_DIR)],
    fetch: (request) => handler.fetch(request),
    error: (error) => {
      console.error('[eng-ops] request failed:', error)
      return new Response('Internal Server Error', { status: 500 })
    },
  })

  await server.ready()
  if (!silent) console.log(`[eng-ops] listening on ${server.url}`)
  return server
}
