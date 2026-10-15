// QA-only contract probe: immutable RED (divergent active PR #2801 branch) vs GREEN
// (complete frozen owner source). No live retailer data or product modifications.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, readFile, rm, chmod, symlink, link, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

const CLI = fileURLToPath(new URL('../scripts/m3-private-outstanding-field-actions.mjs', import.meta.url))
const SENSITIVE = 'SECRET-PRIVATE-OPERATOR-OBSERVATION'
function invoke(cwd, input, ...args) {
  return spawnSync(process.execPath,
    ['--experimental-strip-types', CLI, input, ...args],
    { cwd, encoding: 'utf8', timeout: 15_000 })
}
async function isolated(t, adjust) {
  const directory = await mkdtemp(join(tmpdir(), 'supa-m3-drift-proof-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const draft = buildObservationSheet()
  draft.study.participantKey = 'private-qa-pseudonym'
  draft.study.region = SENSITIVE
  if (adjust) adjust(draft)
  const file = join(directory, 'personal-secret-sheet.json')
  const bytes = Buffer.from(JSON.stringify(draft))
  await writeFile(file, bytes, { mode: 0o600 })
  return { directory, file, bytes }
}
function safeSuccess(run, directory) {
  assert.equal(run.error, undefined, run.error?.message)
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stderr, '')
  assert.doesNotMatch(run.stdout, /SECRET-PRIVATE-OPERATOR-OBSERVATION|personal-secret-sheet\.json/)
  assert.equal(run.stdout.includes(directory), false)
}
function privateRefusal(run, directory) {
  assert.equal(run.error, undefined, run.error?.message)
  assert.notEqual(run.status, 0, 'untrusted local field draft MUST NOT produce a successful checklist')
  assert.equal(run.stdout, '', 'no partial field checklist may be emitted')
  assert.equal(run.stderr.includes(directory), false, 'error may not contain private filesystem path')
  assert.equal(run.stderr.includes(SENSITIVE), false, 'error may not reveal participant details')
}

test('control: original canonical 0600 private field sheet remains read-only and unverified', async t => {
  const { directory, file, bytes } = await isolated(t)
  const response = invoke(directory, file)
  safeSuccess(response, directory)
  const report = JSON.parse(response.stdout)
  assert.equal(report.expectedTotalLines, 22)
  assert.equal(report.remainingTotalLines, 22)
  assert.equal(report.verifiedRetailerObservations, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.deepEqual(await readFile(file), bytes)
  assert.equal((await stat(file)).mode & 0o777, 0o600)
})

test('current-branch acceptance: one-store operator tasklist only includes selected eleven rows', async t => {
  const { directory, file, bytes } = await isolated(t)
  for (const [selection, selected, other] of [
    ['plus', 'PLUS', 'DekaMarkt'],
    ['dekamarkt', 'DekaMarkt', 'PLUS'],
  ]) {
    const response = invoke(directory, file, '--text', '--store', selection)
    safeSuccess(response, directory)
    assert.match(response.stdout, /Openstaande boodschappen: 11 van 11/)
    assert.match(response.stdout, new RegExp(selected + ': 11 van 11 nog te meten'))
    assert.equal(response.stdout.includes(other + ':'), false)
    assert.match(response.stdout, /Geen bewezen winkelprijzen of publieke besparingsclaim/)
  }
  assert.deepEqual(await readFile(file), bytes)
})

test('current-branch acceptance: refuse final-component symlink despite valid private 0600 source', async t => {
  const { directory, file, bytes } = await isolated(t)
  const alias = join(directory, 'linked-private-draft.json')
  await symlink(file, alias)
  privateRefusal(invoke(directory, alias, '--text'), directory)
  assert.deepEqual(await readFile(file), bytes)
})

test('current-branch acceptance: refuse group/world-readable source without showing checklist', async t => {
  const { directory, file, bytes } = await isolated(t)
  await chmod(file, 0o644)
  privateRefusal(invoke(directory, file), directory)
  assert.deepEqual(await readFile(file), bytes)
  assert.equal((await stat(file)).mode & 0o777, 0o644)
})

test('current-branch acceptance: refuse multiply linked input even through original filename', async t => {
  const { directory, file, bytes } = await isolated(t)
  await link(file, join(directory, 'second-private-link.json'))
  privateRefusal(invoke(directory, file, '--text'), directory)
  assert.deepEqual(await readFile(file), bytes)
})

test('current-branch acceptance: refuse valid JSON larger than two MiB before publishing actions', async t => {
  const { directory, file } = await isolated(t, draft => {
    draft.study.region = SENSITIVE + 'x'.repeat(2 * 1024 * 1024)
  })
  const original = await readFile(file)
  assert.ok(original.byteLength > 2 * 1024 * 1024)
  privateRefusal(invoke(directory, file, '--text'), directory)
  assert.deepEqual(await readFile(file), original)
})
