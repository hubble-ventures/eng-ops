#!/usr/bin/env node
/**
 * `npm install` / `npm ci` hook for a *checkout* of eng-ops (npm skips
 * `prepare` when the published package is installed as a dependency).
 *
 * Two jobs, both no-ops when they've already been done:
 *   1. apply patches/ via patch-package
 *   2. make sure a production build exists, so `npm start` and
 *      `npx github:hubble-ventures/eng-ops` work without a manual step
 *
 * Everything here is best-effort: a checkout that only needs `npm run dev`
 * must never be blocked by a failure in this script.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const require = createRequire(import.meta.url)

function run(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) console.warn(`[eng-ops] ${label} failed — run it manually if you need it.`)
  return result.status === 0
}

// 1. Patches. Resolved rather than shelled out to, so a tree without the dev
//    dependency (or with scripts disabled) skips instead of failing.
try {
  const patchPackage = resolve(dirname(require.resolve('patch-package/package.json')), 'index.js')
  run(process.execPath, [patchPackage], 'patch-package')
} catch {
  // patch-package not installed — nothing to apply.
}

// 2. Build, only when there isn't one and there are sources to build from.
if (!existsSync(resolve(root, 'dist/server/server.js')) && existsSync(resolve(root, 'src'))) {
  console.log('[eng-ops] no production build found — running `npm run build` …')
  run('npm', ['run', 'build'], 'build')
}
