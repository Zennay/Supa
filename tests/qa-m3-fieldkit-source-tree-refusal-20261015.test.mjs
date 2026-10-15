import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { buildM3FieldKit, writeM3FieldKit } from '../scripts/m3-prepare-field-kit.mjs'

// Real CLI + exported writer, offline synthetic Git; no retailer data or people.
const REPO = resolve(process.cwd())
const SHA = 'c'.repeat(40)

test('actual CLI refuses normalized destination inside source checkout even on fake clean main', async t => {
  const tmp = await mkdtemp(join(tmpdir(), 'supa-repo-leak-qa-'))
  t.after(async () => rm(tmp, { recursive: true, force: true }))
  const mockGit = join(tmp, 'git')
  const script = `#!/usr/bin/env node
const cmd = process.argv.slice(2).join(' ')
if (cmd === 'symbolic-ref --quiet --short HEAD') console.log('main')
else if (cmd === 'rev-parse --verify HEAD' ||
         cmd === 'rev-parse --verify refs/remotes/origin/main') console.log('cccccccccccccccccccccccccccccccccccccccc')
else if (cmd !== 'status --porcelain --untracked-files=no') process.exit(4)
`
  await writeFile(mockGit, script, { mode: 0o700 })
  await chmod(mockGit, 0o700)
  const destination = join(REPO, 'tests', '..', '.qa-m3-private-refusal-' + randomUUID())
  assert.equal(existsSync(destination), false)
  t.after(async () => rm(destination, { recursive: true, force: true }))
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types', 'scripts/m3-prepare-field-kit.mjs',
    '--output-dir', destination,
  ], {
    cwd: REPO, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PATH: tmp + delimiter + process.env.PATH },
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1, 'private output in Git checkout must be refused')
  assert.equal(result.stdout, '')
  assert.equal(existsSync(destination), false)
  assert.doesNotMatch(result.stderr, /qa-m3-private-refusal|\/tests\//u)
})

test('external symbolic link into source checkout cannot become private evidence sink', async t => {
  const root = await mkdtemp(join(tmpdir(), 'supa-symlink-repo-qa-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const alias = join(root, 'points-into-source-tree')
  await symlink(REPO, alias, 'dir')
  const leaf = '.qa-m3-symlink-source-' + randomUUID()
  const destination = join(alias, leaf)
  assert.equal(existsSync(join(REPO, leaf)), false)
  t.after(async () => rm(join(REPO, leaf), { recursive: true, force: true }))
  await assert.rejects(
    writeM3FieldKit(destination, buildM3FieldKit({ branch: 'main', sha: SHA })),
    /symlinked M3 output parent/u,
  )
  assert.equal(existsSync(destination), false)
  assert.equal(existsSync(join(REPO, leaf)), false)
})
