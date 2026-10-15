import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  chmod, mkdtemp, readFile, readdir, rm, stat, writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fingerprintPrivateM3Draft } from '../scripts/m3-private-evidence-fingerprint.mjs'

// Independent QA on the frozen original #2811 product source. Fingerprints are
// private identity/integrity aids ONLY, not validation of human field evidence.
const CLI = fileURLToPath(new URL('../scripts/m3-private-evidence-fingerprint.mjs', import.meta.url))
const SECRET = 'PRIVATE_FICTIONAL_PARTICIPANT_000_DO_NOT_ECHO'
const MAX = 2 * 1024 * 1024

function fakeDraft(note = SECRET) {
  const lines = Array.from({ length: 11 }, (_, i) => ({
    ingredientId: 'madeup-' + i, observedProduct: { available: null },
  }))
  return {
    schemaVersion: 1,
    sheetType: 'm3-manual-cart-observation-sheet',
    requirements: Array.from({ length: 11 }, (_, i) => ({ id: 'madeup-' + i })),
    baseline: { lines },
    candidate: { lines: structuredClone(lines) },
    note,
  }
}

async function setup(t, bytes = JSON.stringify(fakeDraft())) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-independent-fingerprint-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'private-precisely-do-not-echo.json')
  await writeFile(path, bytes, { mode: 0o600 })
  return { dir, path }
}

function run(path, args = [path]) {
  const child = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8', timeout: 20_000,
  })
  assert.equal(child.error, undefined, child.error?.message)
  return child
}

function assertSecretFree(result, path) {
  const output = result.stdout + result.stderr
  for (const marker of [SECRET, path, 'PRIVATE_FICTIONAL', 'private-precisely-do-not-echo']) {
    assert.equal(output.includes(marker), false, 'private source identity leaked')
  }
}

test('independent M3 fingerprint is stable, SHA256 is byte-exact, and invocation never mutates original', async t => {
  const { dir, path } = await setup(t)
  const before = await readFile(path)
  const first = await fingerprintPrivateM3Draft(path)
  const second = await fingerprintPrivateM3Draft(path)
  assert.deepEqual(first, second)
  assert.deepEqual(first, {
    bytes: before.byteLength,
    sha256: createHash('sha256').update(before).digest('hex'),
  })
  const cli = run(path)
  assert.equal(cli.status, 0, cli.stderr)
  assert.match(cli.stdout, new RegExp('^PRIVATE M3 draft \\(not price verification, consent or savings proof\\)\\n'))
  assert.ok(cli.stdout.includes('bytes: ' + before.length))
  assert.ok(cli.stdout.includes('sha256: ' + first.sha256))
  assertSecretFree(cli, path)
  assert.deepEqual(await readFile(path), before, 'source bytes must not be altered')
  assert.deepEqual(await readdir(dir), ['private-precisely-do-not-echo.json'],
    'a digest must not create byproducts alongside private source')
})

test('same JSON data with only whitespace change receives a *different* fingerprint; never semantic normalization', async t => {
  const document = fakeDraft('synthetic € label ' + SECRET)
  const compact = JSON.stringify(document)
  const pretty = JSON.stringify(document, null, 2) + '\n'
  assert.deepEqual(JSON.parse(pretty), JSON.parse(compact))
  const { path } = await setup(t, compact)
  const initial = await fingerprintPrivateM3Draft(path)
  await writeFile(path, pretty, { mode: 0o600 })
  const changed = await fingerprintPrivateM3Draft(path)
  assert.notEqual(initial.sha256, changed.sha256)
  assert.notEqual(initial.bytes, changed.bytes)
  assert.equal(changed.bytes, Buffer.byteLength(pretty, 'utf8'))
  assert.equal(changed.sha256, createHash('sha256').update(Buffer.from(pretty)).digest('hex'))
  const output = run(path)
  assert.equal(output.status, 0, output.stderr)
  assertSecretFree(output, path)
})

test('real UTF-8 byte budget wins over Unicode character count on exact 2 MiB boundary', async t => {
  const { path } = await setup(t)
  const prefix = Buffer.byteLength(JSON.stringify(fakeDraft('')), 'utf8')
  const capacity = MAX - prefix
  const euros = '€'.repeat(Math.floor(capacity / 3))
  const exact = JSON.stringify(fakeDraft(euros + ' '.repeat(capacity % 3)))
  assert.equal(Buffer.byteLength(exact, 'utf8'), MAX)
  assert.ok(exact.length < MAX, 'Unicode code units differ from file bytes')
  await writeFile(path, exact, { mode: 0o600 })
  const accepted = await fingerprintPrivateM3Draft(path)
  assert.equal(accepted.bytes, MAX)
  assert.equal(accepted.sha256, createHash('sha256').update(Buffer.from(exact)).digest('hex'))

  await writeFile(path, JSON.stringify(fakeDraft(euros + ' '.repeat(capacity % 3 + 1))), { mode: 0o600 })
  const denied = run(path)
  assert.notEqual(denied.status, 0)
  assert.equal(denied.stdout, '')
  assertSecretFree(denied, path)
})

test('M3 fingerprint checks only document shape; fabricated observations must never become verified proof', async t => {
  const fake = fakeDraft()
  fake.baseline.store = { id: 'FICTIONAL_PLUS', name: 'PLUS fictional' }
  fake.candidate.store = { id: 'FICTIONAL_DEKA', name: 'DekaMarkt fictional' }
  for (const side of ['baseline', 'candidate']) {
    for (const line of fake[side].lines) {
      line.observedProduct = { available: true, productName: SECRET,
        priceCents: 999999, sourceUrl: 'https://example.invalid/PRIVATE_FICTIONAL' }
    }
  }
  const { path } = await setup(t, JSON.stringify(fake))
  const result = run(path)
  assert.equal(result.status, 0, result.stderr)
  assertSecretFree(result, path)
  assert.match(result.stdout, /not price verification, consent or savings proof/)
  assert.equal(result.stdout.includes('999999'), false)
  assert.equal(result.stdout.includes('€'), false)
  assert.equal(/verifiedRetailerObservations|publicSavingsClaimEligible|claimable|evidenceId/.test(result.stdout), false,
    'a file checksum must not masquerade as evidence assessment')
})

test('M3 fingerprint refuses 10/12-line forged shells and invalid schema with generic no-leak CLI', async t => {
  const { path } = await setup(t)
  const scenarios = [
    draft => { draft.requirements.pop() },
    draft => { draft.baseline.lines.pop() },
    draft => { draft.candidate.lines.push({ ingredientId: SECRET }) },
    draft => { draft.schemaVersion = 2 },
    draft => { draft.sheetType = 'FICTIONAL_WRONG_SHEET' },
    draft => { draft.baseline = {} },
  ]
  for (const change of scenarios) {
    const fake = fakeDraft()
    change(fake)
    await writeFile(path, JSON.stringify(fake), { mode: 0o600 })
    const rejected = run(path)
    assert.notEqual(rejected.status, 0)
    assert.equal(rejected.stdout, '')
    assert.match(rejected.stderr, /^private M3 draft refused /)
    assertSecretFree(rejected, path)
  }
})

test('M3 fingerprint rejects unsafe permissions and directory inputs before emitting hashes', async t => {
  const { dir, path } = await setup(t)
  for (const mode of [0o644, 0o640, 0o606, 0o660]) {
    await chmod(path, mode)
    const rejected = run(path)
    assert.notEqual(rejected.status, 0, mode.toString(8))
    assert.equal(rejected.stdout, '')
    assertSecretFree(rejected, path)
  }
  await chmod(path, 0o600)
  const dirResult = run(dir)
  assert.notEqual(dirResult.status, 0)
  assert.equal(dirResult.stdout, '')
  assertSecretFree(dirResult, dir)
  assert.equal((await stat(path)).mode & 0o777, 0o600)
})

test('M3 fingerprint CLI refuses missing/excessive/unknown flags without leaking paths or writing output', async t => {
  const { dir, path } = await setup(t)
  for (const args of [[], [path, path], ['--unknown'], [path, '--help']]) {
    const rejected = run(path, args)
    assert.notEqual(rejected.status, 0, args.join(' '))
    assert.equal(rejected.stdout, '')
    assertSecretFree(rejected, path)
  }
  assert.deepEqual(await readdir(dir), ['private-precisely-do-not-echo.json'])
})
