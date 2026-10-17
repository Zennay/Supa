import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import { safePrivateM3Progress } from '../scripts/qa-m3-private-field-progress-readguard-20261017.mjs'

const SCRIPT = fileURLToPath(new URL('../scripts/qa-m3-private-field-progress-readguard-20261017.mjs', import.meta.url))
const CANARY = 'FICTIONAL_FIELD_OPERATOR_PRIVATE_PSEUDONYM_NEVER_ECHO'
const MAX_BYTES = 2 * 1024 * 1024
const REFUSAL = /^Private M3 operator draft refused \(regular, private single-link JSON <=2MiB required\)\n$/

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-m3-safe-progress-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'private')
  await mkdir(folder, { mode: 0o700 })
  const file = join(folder, 'secret.json')
  const sheet = buildObservationSheet()
  sheet.study.participantKey = CANARY
  await writeFile(file, JSON.stringify(sheet), { mode: 0o600 })
  return { root, folder, file, sheet }
}

function run(file) {
  const child = spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, file], {
    encoding: 'utf8',
    timeout: 10000,
  })
  assert.equal(child.error, undefined, 'safe progress process must exit')
  for (const sensitive of [CANARY, file, 'secret.json', 'PRIVATE_PSEUDONYM']) {
    assert.ok(!(child.stdout + child.stderr).includes(sensitive), 'private bytes/path in output')
  }
  return child
}

function refused(file) {
  const child = run(file)
  assert.notEqual(child.status, 0)
  assert.equal(child.stdout, '')
  assert.match(child.stderr, REFUSAL)
}

test('QA safe-reader returns only unverified 11x2 progress from canonical private 0600 JSON', async t => {
  const { file } = await setup(t)
  const before = await readFile(file)
  const report = await safePrivateM3Progress(file, Date.parse('2026-10-17T08:00:00Z'))
  assert.deepEqual(await readFile(file), before, 'source evidence bytes must never change')
  assert.equal(report.progress.expectedLines, 22)
  assert.equal(report.progress.completeLines, 0)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.verifiedRetailerObservations, false)
  assert.equal(report.evidenceStatus, 'unverified-operator-draft')
  const child = run(file)
  assert.equal(child.status, 0, child.stderr)
  assert.equal(child.stderr, '')
  assert.equal(JSON.parse(child.stdout).publicSavingsClaimEligible, false)
})

test('QA safe-reader refuses group-readable 0640 files', async t => {
  const { file } = await setup(t)
  await chmod(file, 0o640)
  refused(file)
})

test('QA safe-reader refuses world-readable 0644 files', async t => {
  const { file } = await setup(t)
  await chmod(file, 0o644)
  refused(file)
})

test('QA safe-reader refuses leaf symlinks and does not resolve their data', async t => {
  const { root, file } = await setup(t)
  const alias = join(root, 'leaf-alias.json')
  await symlink(file, alias)
  refused(alias)
})

test('QA safe-reader refuses symlinked parent dirs before opening target file', async t => {
  const { root, folder, file } = await setup(t)
  const alias = join(root, 'parent-alias')
  await symlink(folder, alias, 'dir')
  refused(join(alias, file.split('/').at(-1)))
})

test('QA safe-reader refuses multiple hardlinks to an otherwise private regular file', async t => {
  const { root, file } = await setup(t)
  await link(file, join(root, 'second-name.json'))
  refused(file)
})

test('QA safe-reader refuses >2MiB file without parsing a plausible large draft', async t => {
  const { file, sheet } = await setup(t)
  sheet.untrustedPadding = '€'.repeat(Math.ceil(MAX_BYTES / 3))
  const body = JSON.stringify(sheet)
  assert.ok(Buffer.byteLength(body, 'utf8') > MAX_BYTES)
  await writeFile(file, body, { mode: 0o600 })
  refused(file)
})

test('QA safe-reader rejects invalid UTF-8 rather than silently replacing participant bytes', async t => {
  const { file } = await setup(t)
  await writeFile(file, Buffer.from([0x7b, 0xff, 0x7d]), { mode: 0o600 })
  refused(file)
})

test('QA safe-reader refuses directories, missing sources, and invalid argv without echo', async t => {
  const { root, file } = await setup(t)
  refused(root)
  refused(join(root, 'absent.json'))
  for (const args of [[], [file, file], ['--help']]) {
    const child = spawnSync(process.execPath, ['--experimental-strip-types', SCRIPT, ...args], {
      encoding: 'utf8',
      timeout: 10000,
    })
    assert.notEqual(child.status, 0)
    assert.equal(child.stdout, '')
    assert.match(child.stderr, REFUSAL)
    assert.ok(!child.stderr.includes(CANARY), 'refusal must not echo participant identity')
  }
})
