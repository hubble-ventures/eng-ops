#!/usr/bin/env node
/**
 * Port allocation for this checkout. See scripts/lib/portlock.mjs for why.
 *
 *   node scripts/portlock.mjs              claim (or confirm) a block
 *   node scripts/portlock.mjs --print      dump .worktree/ports.env
 *   node scripts/portlock.mjs --release    give the block back
 *   node scripts/portlock.mjs --exec CMD…  run CMD with the ports in its env
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { acquire, envForChild, ensurePorts, PORTS_ENV, release } from './lib/portlock.mjs'

const [mode, ...rest] = process.argv.slice(2)

if (mode === '--release') {
  const released = release()
  console.log(
    released.length > 0
      ? `released ports ${released.join(', ')}`
      : 'no port block claimed by this checkout',
  )
} else if (mode === '--print') {
  await ensurePorts()
  process.stdout.write(readFileSync(PORTS_ENV, 'utf8'))
} else if (mode === '--exec') {
  if (rest.length === 0) {
    console.error('portlock: --exec needs a command')
    process.exit(2)
  }
  const child = spawn(rest[0], rest.slice(1), {
    stdio: 'inherit',
    env: await envForChild(),
  })
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
} else {
  const ports = await acquire()
  console.log(`${PORTS_ENV}\nPORTBASE=${ports.PORTBASE} WEB_PORT=${ports.WEB_PORT} POSTGRES_PORT=${ports.POSTGRES_PORT}`)
}
