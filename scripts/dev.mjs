#!/usr/bin/env node
/**
 * Start the dev server on this checkout's claimed port — through portless when
 * it is installed, so the browser gets a name instead of a number.
 *
 * The two tools solve different halves and are wired to agree rather than
 * compete:
 *
 * - **portlock** decides the port. Deterministic, collision-free across
 *   worktrees and the other stacks on the machine, and identical whether or not
 *   portless is present. It also covers Postgres, which portless cannot: the
 *   proxy is HTTP-only.
 * - **portless** gives that port a name. `--app-port` is the seam: it tells
 *   portless to proxy the port we already claimed instead of assigning its own
 *   random one from 4000-4999. Without it the two would fight, which is exactly
 *   the objection that kept portless out of the paddles-up stack.
 *
 * The port is set in vite.config.ts from WEB_PORT with `strictPort`, so it is
 * the same number either way and never silently drifts. portless is strictly
 * optional: no binary, or PORTLESS=0, and this runs plain vite.
 */
import { spawn } from 'node:child_process'

import { envForChild, portlessAvailable } from './lib/portlock.mjs'

const env = await envForChild()
const webPort = env.WEB_PORT

const optedOut = process.env.PORTLESS === '0'
const wanted = process.env.PORTLESS === '1'
const available = portlessAvailable()

let command
if (optedOut || (!available && !wanted)) {
  if (!available && !optedOut) {
    console.log(
      '[eng-ops] portless not installed — serving on the port directly.\n' +
        '[eng-ops] `npm i -g portless` for https://eng-ops.localhost instead of a port number.',
    )
  }
  command = ['npx', 'vite', 'dev']
} else if (!available && wanted) {
  console.error('[eng-ops] PORTLESS=1 but no `portless` on PATH. Install it, or unset PORTLESS.')
  process.exit(1)
} else {
  // No --name: `portless run` infers it from package.json and, in a linked git
  // worktree, prepends the branch as a subdomain — so every worktree gets its
  // own URL for free, which is the whole reason to layer it on.
  command = ['portless', 'run', '--app-port', webPort, 'npx', 'vite', 'dev']
}

console.log(`[eng-ops] dev server on port ${webPort} (portlock block ${env.PORTBASE})`)
const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env })
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
