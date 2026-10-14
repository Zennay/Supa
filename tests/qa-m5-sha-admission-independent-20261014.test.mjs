import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { compareCaptureDirectories } from '../scripts/m5-compare-capture-signatures.mjs'

// Independent, fictional local-only QA; no real retailers or personal data.
const HTML = '<!doctype html><html><body>independent synthetic content</body></html>'
const SHA = createHash('sha256').update(HTML).digest('hex')
const CLI = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const source = (patch = {}) => ({
  id: 'fictional-first', supermarket: 'fictional-market', kind: 'product',
  success: true, requestedUrl: 'https://example.invalid/qa',
  capturedAt: '2026-10-14T00:00:00Z', sha256: SHA, ...patch,
})
async function sandbox(fn) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-sha-admission-'))
  try { await fn(root) } finally { await rm(root, { recursive: true, force: true }) }
}
async function capture(root, label, rows, includeHTML = false) {
  const dir = join(root, label)
  await mkdir(dir)
  const raw = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: rows.length, results: rows,
  })
  const manifest = join(dir, 'manifest.json')
  await writeFile(manifest, raw)
  if (includeHTML) for (const row of rows) {
    if (!row.success) continue
    await mkdir(join(dir, row.supermarket), { recursive: true })
    await writeFile(join(dir, row.supermarket, row.id + '.html'), HTML)
  }
  return { dir, manifest, raw }
}
function call(now, before) {
  const r = spawnSync(process.execPath, [
    '--experimental-strip-types', CLI, now.dir, ...(before ? [before.dir] : []),
  ], { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 })
  assert.equal(r.error, undefined)
  assert.equal(r.signal, null)
  assert.doesNotMatch(r.stdout + r.stderr, /fictional-market|example\.invalid|supa-qa-sha-admission-/)
  return r
}
function manual(r, priority, status) {
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  const payload = JSON.parse(r.stdout)
  assert.equal(payload.actions.length, 1)
  assert.equal(payload.actions[0].priority, priority)
  assert.equal(payload.actions[0].status, status)
  for (const key of ['productionReady', 'rightsVerified', 'selectorVerified', 'm5Eligible']) {
    assert.equal(payload[key], false, key)
  }
  assert.equal(payload.actions[0].productionEnabled, false)
}
async function assertEarlyFailure(now, before) {
  // Earlier valid success HTML intentionally does not exist. The precise raw
  // manifest error proves rejection BEFORE the canonical HTML inspector.
  await assert.rejects(compareCaptureDirectories(now.dir, before?.dir), err =>
    err instanceof Error && err.message === 'Invalid or oversized M1 capture manifest')
  const r = call(now, before)
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, 'Offline review failed: invalid capture or report\n')
  assert.equal(await readFile(now.manifest, 'utf8'), now.raw)
  if (before) assert.equal(await readFile(before.manifest, 'utf8'), before.raw)
}
test('independent SHA positive: P2 authentic digest and HTML stays private', async () => {
  await sandbox(async root => {
    const now = await capture(root, 'now', [source()], true)
    manual(call(now), 'P2', 'baseline_missing')
    assert.equal(await readFile(now.manifest, 'utf8'), now.raw)
  })
})
test('independent SHA positive: P1 unavailable has no SHA or HTML', async () => {
  await sandbox(async root => {
    const now = await capture(root, 'now', [
      { id: 'fictional-first', supermarket: 'fictional-market', kind: 'product', success: false },
    ])
    manual(call(now), 'P1', 'unavailable')
  })
})
test('independent SHA positive: older independent SHA capture stays P3 private', async () => {
  await sandbox(async root => {
    const now = await capture(root, 'now', [source()], true)
    const before = await capture(root, 'older',
      [source({ capturedAt: '2026-10-13T00:00:00Z' })], true)
    manual(call(now, before), 'P3', 'unchanged')
  })
})
for (const [name, digest] of [
  ['missing', undefined], ['null', null], ['numeric', 5], ['array', [SHA]],
  ['uppercase', SHA.toUpperCase()], ['short-63', SHA.slice(0, 63)],
  ['long-65', SHA + 'a'], ['non-hex', 'z'.repeat(64)],
  ['leading-space', ' ' + SHA], ['trailing-newline', SHA + '\n'],
]) {
  test('independent SHA negative: ' + name + ' on later row fails BEFORE HTML', async () => {
    await sandbox(async root => {
      const now = await capture(root, 'now', [
        source(), source({ id: 'fictional-second', sha256: digest }),
      ])
      await assertEarlyFailure(now)
    })
  })
}
test('independent SHA negative: invalid older manifest refuses before absent current HTML', async () => {
  await sandbox(async root => {
    const now = await capture(root, 'now', [source()])
    const before = await capture(root, 'older',
      [source({ capturedAt: '2026-10-13T00:00:00Z', sha256: 'a'.repeat(63) })])
    await assertEarlyFailure(now, before)
  })
})
test('independent SHA distinction: valid grammar cannot excuse wrong HTML hash', async () => {
  await sandbox(async root => {
    const now = await capture(root, 'now', [source({ sha256: '0'.repeat(64) })], true)
    await assert.rejects(compareCaptureDirectories(now.dir), err =>
      err instanceof Error && err.message !== 'Invalid or oversized M1 capture manifest')
    const r = call(now)
    assert.notEqual(r.status, 0)
    assert.equal(r.stdout, '')
    assert.equal(r.stderr, 'Offline review failed: invalid capture or report\n')
    assert.equal(await readFile(now.manifest, 'utf8'), now.raw)
  })
})
