#!/usr/bin/env node
/**
 * Fail when the committed browser/host artifacts no longer match the source.
 *
 * This repository deliberately commits `lib/`: a git-hosted install must find
 * `main` already built, otherwise pnpm treats the checkout as needing build
 * scripts and refuses to install it until the operator adds an `allowBuilds`
 * entry (see README "Install"). Committing build output only stays honest if
 * something proves it was rebuilt from the source beside it — so every
 * `npm run check` rebuilds `lib/` (via `pack:check`) and this script asserts
 * the rebuild produced exactly what is committed.
 *
 * A checkout without `.git` (the published tarball, an extracted package) is
 * skipped: there is nothing to be stale against.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
if (!existsSync(join(root, '.git'))) process.exit(0)

const result = spawnSync('git', ['status', '--porcelain', '--', 'lib'], {
  cwd: root,
  encoding: 'utf8',
})
if (result.status !== 0) {
  process.stderr.write(result.stderr ?? 'git status failed\n')
  process.exit(1)
}
const stale = (result.stdout ?? '').trim()
if (stale.length === 0) {
  process.stdout.write('committed lib/ matches the source\n')
  process.exit(0)
}
process.stderr.write(
  `committed lib/ is stale or uncommitted:\n${stale}\n`
  + 'Run `npm run build` and commit lib/ — a git-hosted install ships exactly what is committed.\n',
)
process.exit(1)
