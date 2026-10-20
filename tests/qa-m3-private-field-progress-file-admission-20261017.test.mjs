import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { chmod, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

// Synthetic blank canonical 11x2 field template only: no retailer visits,
// source-rights grants, actual prices or savings evidence.
const CLI = fileURLToPath(new URL('../scripts/m3-private-field-progress.mjs', import.meta.url))
const CANARY = 'FICTIONAL_PRIVATE_FIELD_ID_NEVER_PRINT_20261017'
const MAX_BYTES = 2 * 1024 * 1024

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'supa-private-progress-input-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const privateDir = join(root, 'private')
  await mkdir(privateDir, { mode: 0o700 })
  const file = join(privateDir, CANARY + '.json')
  const sheet = buildObservationSheet()
  sheet.study.participantKey = CANARY
  await writeFile(file, JSON.stringify(sheet), { mode: 0o600 })
  return { root, privateDir, file, sheet }
}

function run(file) {
  const child = spawnSync(process.execPath, ['--experimental-strip-types', CLI, file], {
    encoding: 'utf8', timeout: 10000,
  })
  assert.equal(child.error, undefined, 'CLI must terminate without hanging')
  for (const exposed of [CANARY, file, 'PRIVATE_FIELD_ID']) {
    assert.equal((child.stdout + child.stderr).includes(exposed), false,
      'private participant or source path leaked')
  }
  return child
}

function mustRefuse(file) {
  const result = run(file)
  assert.notEqual(result.status, 0, 'untrusted private draft path must be refused')
  assert.equal(result.stdout, '', 'no plausible private progress JSON on refusal')
  assert.match(result.stderr, /^M3 private field progress could not be generated\n$/)
}

test('control: canonical local 0600 single-link file yields ONLY aggregate 11x2 unverified progress', async (t) => {
  const { file } = await setup(t)
  const before = await readFile(file)
  const result = run(file)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stderr, '')
  const report = JSON.parse(result.stdout)
  assert.equal(report.progress.expectedLines, 22)
  assert.equal(report.progress.completeLines, 0)
  assert.equal(report.readyForPrivateReview, false)
  assert.equal(report.verifiedRetailerObservations, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.deepEqual(await readFile(file), before, 'read-only CLI must preserve private evidence bytes')
})

test('P1 private-progress CLI refuses group-readable draft before parsing', async (t) => {
  const { file } = await setup(t)
  await chmod(file, 0o640)
  mustRefuse(file)
})

test('P1 private-progress CLI refuses world-readable draft before parsing', async (t) => {
  const { file } = await setup(t)
  await chmod(file, 0o644)
  mustRefuse(file)
})

test('P1 private-progress CLI refuses final-component symlink to an otherwise private draft', async (t) => {
  const { root, file } = await setup(t)
  const alias = join(root, 'field-alias.json')
  await symlink(file, alias)
  mustRefuse(alias)
})

test('P1 private-progress CLI refuses symlinked ancestor even with safe final-file mode', async (t) => {
  const { root, privateDir, file } = await setup(t)
  const alias = join(root, 'aliased-dir')
  await symlink(privateDir, alias, 'dir')
  mustRefuse(join(alias, file.split('/').at(-1)))
})

test('P1 private-progress CLI refuses multi-linked draft shared by another filesystem name', async (t) => {
  const { root, file } = await setup(t)
  await link(file, join(root, 'second-hardlink.json'))
  mustRefuse(file)
})

test('P1 private-progress CLI refuses >2 MiB UTF-8 JSON even if restoration discards unknown fields', async (t) => {
  const { file, sheet } = await setup(t)
  sheet.syntheticPadding = 'x'.repeat(MAX_BYTES)
  const encoded = JSON.stringify(sheet)
  assert.ok(Buffer.byteLength(encoded, 'utf8') > MAX_BYTES)
  await writeFile(file, encoded, { mode: 0o600 })
  mustRefuse(file)
})
