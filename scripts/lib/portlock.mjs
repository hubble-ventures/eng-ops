/**
 * Claim a stable, collision-free port block for this checkout.
 *
 * Several worktrees of this repo (and the other stacks on your machine) run at
 * the same time, so a hardcoded port is a collision waiting to happen — `npm
 * run dev` on :3000 and the demo Postgres on :5432 both lose to whatever
 * grabbed the port first.
 *
 * The claim is **stable**: the same directory gets the same block every time,
 * so a URL in your notes keeps working across restarts. That is the difference
 * from scanning for the first free port, where the same worktree could land on
 * 3000 one day and 3002 the next depending on what else happened to be
 * listening. A block is released only when its directory no longer exists, or
 * on an explicit `--release`.
 *
 * Ported from `performance-pickleball`'s `infra/scripts/worktree/portlock.sh`,
 * in Node so it is one `node scripts/…` away in a repo that has no other shell
 * infrastructure. The port range is deliberately its own, so a claim here can
 * never collide with that repo's (53000-53990) or paddles-up's (3100+).
 */
import { Socket } from 'node:net'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT_MIN = 54000
const PORT_MAX = 54990
const BLOCK = 10

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const PORTS_ENV = join(REPO_ROOT, '.worktree', 'ports.env')

const REGISTRY = join(
  process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'),
  'eng-ops',
  'portlocks',
)

/** Compose project names must be lowercase alphanumeric, dash or underscore. */
function slug() {
  return (
    REPO_ROOT.split('/')
      .pop()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'eng-ops'
  )
}

/** Deterministic starting point, so a checkout tends to reclaim its old block. */
function preferredBase() {
  let hash = 0
  for (const char of REPO_ROOT) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const slots = Math.floor((PORT_MAX - PORT_MIN) / BLOCK)
  return PORT_MIN + (hash % slots) * BLOCK
}

/** Can something be reached on this address:port right now? */
function canConnect(host, port) {
  return new Promise((done) => {
    const socket = new Socket()
    const finish = (reachable) => {
      socket.destroy()
      done(reachable)
    }
    socket.setTimeout(250)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false)) // ECONNREFUSED — nothing there
    socket.connect(port, host)
  })
}

/**
 * A port is free when nothing answers on it.
 *
 * This is a *connect* test, not a bind test, and both halves of that matter.
 * Binding is the obvious implementation and it is wrong twice over: Node sets
 * SO_REUSEADDR, so on macOS a bind to `127.0.0.1:p` succeeds even while Docker
 * holds a wildcard listener on the same port; and a bind to the IPv4 loopback
 * says nothing about a server listening on `[::1]` — which is where Vite lands
 * by default. Both cases report a busy port as free, and hand out a block that
 * is already in use.
 *
 * So: try to reach it, on both loopback families.
 */
async function portIsFree(port) {
  const reachable = await Promise.all([
    canConnect('127.0.0.1', port),
    canConnect('::1', port),
  ])
  return !reachable.includes(true)
}

async function blockIsFree(base) {
  const free = await Promise.all(
    Array.from({ length: BLOCK }, (_, offset) => portIsFree(base + offset)),
  )
  return !free.includes(false)
}

/** A claim is ours, stale (its directory is gone), or someone else's. */
function claimState(base) {
  const file = join(REGISTRY, String(base))
  if (!existsSync(file)) return 'free'
  const owner = readFileSync(file, 'utf8').trim()
  if (owner === REPO_ROOT) return 'ours'
  return existsSync(owner) ? 'taken' : 'stale'
}

/**
 * The lock is a directory, because mkdir is atomic. That makes it a good mutex
 * and a bad thing to leave behind: nothing else here would ever remove it, and
 * a block whose lock survives could never be claimed again. So release it on
 * any exit, and sweep any that a SIGKILL got past the handler — a lock older
 * than a minute cannot belong to a live acquire, since the whole walk is
 * bounded by a couple of seconds.
 */
let lockHeld = null
function releaseLock() {
  if (lockHeld) {
    try {
      rmSync(lockHeld, { recursive: true })
    } catch {
      // already gone
    }
    lockHeld = null
  }
}
for (const signal of ['exit', 'SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    releaseLock()
    if (signal !== 'exit') process.exit(1)
  })
}

function sweepStaleLocks() {
  for (const entry of readdirSync(REGISTRY, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('.lock-')) continue
    const path = join(REGISTRY, entry.name)
    if (Date.now() - statSync(path).mtimeMs > 60_000) {
      try {
        rmSync(path, { recursive: true })
      } catch {
        // raced with its owner; harmless
      }
    }
  }
}

/**
 * Ports are NAMED here rather than recomputed as PORTBASE+n at each call site,
 * so exactly one place decides what lives where. +0 is the container, +1 the
 * dev server; +2..+9 are headroom.
 */
function renderEnv(base) {
  return `# Generated by scripts/portlock.mjs — do not edit, do not commit.
# Stable port block claimed for this checkout.
COMPOSE_PROJECT_NAME=eng-ops-${slug()}
PORTBASE=${base}

# Container.
POSTGRES_PORT=${base + 0}

# Vite dev server. When portless is in play this stays the app's real port and
# portless proxies a name to it (\`--app-port\`), so the URL gets friendlier
# without the port becoming unpredictable.
WEB_PORT=${base + 1}

# Connection string for the throwaway stack in docker-compose.yml. A
# DATABASE_URL set in the real environment or in .env wins over this — pointing
# eng-ops at your own database is the normal case, and this is only the default
# for the demo stack.
DATABASE_URL=postgres://postgres:postgres@localhost:${base + 0}/postgres
`
}

/** Parse a KEY=value env file into a plain object. */
export function parseEnvFile(path) {
  const out = {}
  let content
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    return out
  }
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return out
}

/** Claim a block (or confirm the existing claim) and write `.worktree/ports.env`. */
export async function acquire() {
  mkdirSync(REGISTRY, { recursive: true })
  mkdirSync(join(REPO_ROOT, '.worktree'), { recursive: true })
  sweepStaleLocks()

  const start = preferredBase()
  const slots = Math.floor((PORT_MAX - PORT_MIN) / BLOCK)
  let chosen = null

  // Walk the whole range from the preferred base, wrapping, so a full registry
  // is a hard error rather than a silent collision.
  for (let i = 0; i < slots && chosen === null; i++) {
    const base = PORT_MIN + (((start - PORT_MIN) / BLOCK + i) % slots) * BLOCK
    const state = claimState(base)
    if (state === 'ours') {
      chosen = base
      break
    }
    if (state === 'taken') continue

    const lock = join(REGISTRY, `.lock-${base}`)
    try {
      mkdirSync(lock)
    } catch {
      continue // a concurrent acquirer holds it
    }
    // Recorded before anything else, so the exit handler can release it however
    // we leave this block.
    lockHeld = lock
    if (claimState(base) !== 'taken' && (await blockIsFree(base))) {
      writeFileSync(join(REGISTRY, String(base)), REPO_ROOT)
      chosen = base
    }
    releaseLock()
  }

  if (chosen === null) {
    throw new Error(
      `portlock: no free port block in ${PORT_MIN}-${PORT_MAX}.\n` +
        `portlock: run \`npm run ports:release\` in checkouts you are done with.`,
    )
  }

  writeFileSync(PORTS_ENV, renderEnv(chosen))
  return parseEnvFile(PORTS_ENV)
}

/** Give up this checkout's claim. */
export function release() {
  mkdirSync(REGISTRY, { recursive: true })
  const released = []
  for (const entry of readdirSync(REGISTRY, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const file = join(REGISTRY, entry.name)
    if (readFileSync(file, 'utf8').trim() === REPO_ROOT) {
      rmSync(file)
      released.push(`${entry.name}-${Number(entry.name) + BLOCK - 1}`)
    }
  }
  rmSync(PORTS_ENV, { force: true })
  return released
}

/** The claimed ports, claiming them first if this checkout has none yet. */
export async function ensurePorts() {
  if (existsSync(PORTS_ENV)) {
    const existing = parseEnvFile(PORTS_ENV)
    // A file left behind by a checkout that has since been re-created elsewhere
    // is not a claim; re-acquire rather than trust it.
    if (existing.PORTBASE && claimState(Number(existing.PORTBASE)) === 'ours') {
      return existing
    }
  }
  return await acquire()
}

/**
 * Environment for a child process: the claimed ports, overlaid by `.env`, then
 * by the real environment. Lowest precedence for the generated file is the
 * point — pointing eng-ops at your own database must keep working.
 */
export async function envForChild() {
  const ports = await ensurePorts()
  return { ...ports, ...parseEnvFile(join(REPO_ROOT, '.env')), ...process.env }
}

/**
 * True when a `portless` binary is on PATH.
 *
 * Resolved by scanning PATH rather than shelling out to `command -v`: no
 * subprocess, and nothing to escape.
 */
export function portlessAvailable() {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (!dir) continue
    try {
      const path = join(dir, 'portless')
      if (statSync(path).isFile()) return true
    } catch {
      // not here; keep looking
    }
  }
  return false
}
