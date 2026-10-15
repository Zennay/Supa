import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { chmod, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { buildM3FieldKit } from '../scripts/m3-prepare-field-kit.mjs'

// The actual CLI is run offline with a fake git executable in a private
// subprocess PATH. This NEVER changes the real Git checkout or source data.
const PIN = 'a'.repeat(40)
const MOCK_GIT = `#!/usr/bin/env node
const cmd = process.argv.slice(2).join(' ')
const mode = process.env.QA_FAKE_MAIN_STATE || 'clean'
if (cmd === 'symbolic-ref --quiet --short HEAD') {
  if (mode === 'detached') process.exit(1)
  process.stdout.write((mode === 'feature' ? 'feature/test' : 'main') + '\\n')
} else if (cmd === 'rev-parse --verify HEAD') {
  process.stdout.write((mode === 'invalid-head' ? 'wrong' : 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') + '\\n')
} else if (cmd === 'rev-parse --verify refs/remotes/origin/main') {
  process.stdout.write((mode === 'stale' ? 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' : 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') + '\\n')
} else if (cmd === 'status --porcelain --untracked-files=no') {
  if (mode === 'dirty') process.stdout.write(' M src/domain/m3ObservationSheet.ts\\n')
} else {
  process.exit(5)
}
`

async function isolatedCliEnvironment(t) {
  const root = await mkdtemp(join(tmpdir(), 'supa-m3-cli-qa-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  const fakeGit = join(root, 'git')
  await writeFile(fakeGit, MOCK_GIT, { mode: 0o700 })
  await chmod(fakeGit, 0o700)
  return {
    root,
    run(destination, mode = 'clean', extra = []) {
      return spawnSync(process.execPath, [
        '--experimental-strip-types', 'scripts/m3-prepare-field-kit.mjs',
        '--output-dir', destination, ...extra,
      ], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 30000,
        env: { ...process.env, PATH: root + delimiter + process.env.PATH,
          QA_FAKE_MAIN_STATE: mode },
      })
    },
  }
}

test('actual private CLI persists byte-identical 11x2 empty field kit with SHA and mode 0700/0600', async t => {
  const env = await isolatedCliEnvironment(t)
  const dest = join(env.root, 'actual-new-private-field-kit')
  const run = env.run(dest)
  assert.equal(run.error, undefined)
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stderr, '')
  assert.match(run.stdout, /vier LEGE private veldbestanden gemaakt op main/u)
  assert.match(run.stdout, new RegExp(PIN))
  assert.equal((await lstat(dest)).mode & 0o777, 0o700)
  assert.deepEqual((await readdir(dest)).sort(), [
    'START-HERE.txt', 'collection-sheet.json', 'field-form.html', 'source-revision.json',
  ].sort())
  const expected = buildM3FieldKit({ branch: 'main', sha: PIN })
  for (const [name, bytes] of Object.entries(expected)) {
    assert.equal((await lstat(join(dest, name))).mode & 0o777, 0o600)
    assert.equal(await readFile(join(dest, name), 'utf8'), bytes, name)
  }
  const revision = JSON.parse(await readFile(join(dest, 'source-revision.json'), 'utf8'))
  assert.equal(revision.sourceCommitSha, PIN)
  assert.equal(revision.verifiedRetailerObservations, false)
  assert.equal(revision.publicSavingsClaimEligible, false)
  assert.equal(revision.evidenceStatus, 'collection-kit-not-evidence')
  const sheet = JSON.parse(await readFile(join(dest, 'collection-sheet.json'), 'utf8'))
  assert.equal(sheet.requirements.length, 11)
  for (const side of ['baseline', 'candidate']) {
    assert.equal(sheet[side].lines.length, 11)
    assert.ok(sheet[side].lines.every(x =>
      x.observedProduct.available === null && x.observedProduct.priceCents === null))
  }
  assert.equal(Object.hasOwn(sheet.study, 'sourceCommitSha'), false,
    'Companion SHA is not yet persisted in study schema (issue #205)')
})

test('real CLI rejects detached, feature, stale, dirty and invalid HEAD without any files', async t => {
  const env = await isolatedCliEnvironment(t)
  for (const mode of ['detached', 'feature', 'stale', 'dirty', 'invalid-head']) {
    const dest = join(env.root, 'secret-' + mode)
    const run = env.run(dest, mode)
    assert.equal(run.error, undefined)
    assert.equal(run.status, 1, mode)
    assert.equal(run.stdout, '', mode)
    assert.equal(existsSync(dest), false, mode)
    assert.match(run.stderr, /M3 field kit geweigerd/u)
    assert.doesNotMatch(run.stderr, /secret-/u)
  }
})

test('real CLI refuses an existing private file and keeps its bytes unchanged', async t => {
  const env = await isolatedCliEnvironment(t)
  const dest = join(env.root, 'private-sentinel-do-not-replace')
  await writeFile(dest, 'UNRELATED PRIVATE EVIDENCE DO NOT CHANGE', { mode: 0o600 })
  const run = env.run(dest)
  assert.equal(run.status, 1)
  assert.equal(run.stdout, '')
  assert.equal(await readFile(dest, 'utf8'), 'UNRELATED PRIVATE EVIDENCE DO NOT CHANGE')
  assert.doesNotMatch(run.stderr, /private-sentinel-do-not-replace|UNRELATED PRIVATE EVIDENCE/u)
})

test('real CLI rejects a symlinked parent alias before writing any files', async t => {
  const env = await isolatedCliEnvironment(t)
  const physical = join(env.root, 'physical-parent')
  const alias = join(env.root, 'alias')
  await mkdir(physical)
  await symlink(physical, alias)
  const run = env.run(join(alias, 'new-kit'))
  assert.equal(run.status, 1)
  assert.equal(run.stdout, '')
  assert.deepEqual(await readdir(physical), [])
  assert.doesNotMatch(run.stderr, /physical-parent|alias/u)
})

test('real CLI refuses duplicate output flags and user-supplied fake revision before I/O', async t => {
  const env = await isolatedCliEnvironment(t)
  const dest = join(env.root, 'must-not-exist')
  for (const extra of [
    ['--output-dir', join(env.root, 'other-private')],
    ['--sha', PIN],
  ]) {
    const run = env.run(dest, 'clean', extra)
    assert.equal(run.status, 1)
    assert.equal(run.stdout, '')
    assert.equal(existsSync(dest), false)
    assert.doesNotMatch(run.stderr, /must-not-exist|other-private/u)
  }
})
