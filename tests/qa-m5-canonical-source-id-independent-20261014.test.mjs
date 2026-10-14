import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  captureShape, compareInspections, compareCaptureDirectories,
} from '../scripts/m5-compare-capture-signatures.mjs'

// Independent quality-validation; no real source data, retailer requests,
// permission assertions, users or production publishing.
const HTML = '<!doctype html><html><body>independently invented M5 sample</body></html>'
const SHA = createHash('sha256').update(HTML).digest('hex')
const CLI = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const ID128 = 'A' + 'a'.repeat(127)
const ID129 = ID128 + 'b'
const MARKET = 'fictional-market'
const at = '2026-10-14T00:00:00.000Z'
const row = (id = 'good-source', extra = {}) => ({
  id, supermarket: MARKET, kind: 'product', success: true,
  requestedUrl: 'https://example.invalid/independent-test',
  capturedAt: at, sha256: SHA, ...extra,
})
const unavailable = (id) => ({
  id, supermarket: MARKET, kind: 'product', success: false,
})
async function fixture(root, name, records, withHTML = false) {
  const dir = join(root, name)
  await mkdir(dir)
  const manifest = join(dir, 'manifest.json')
  const raw = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: records.length, results: records,
  })
  await writeFile(manifest, raw)
  if (withHTML) for (const rec of records) {
    if (!rec.success) continue
    await mkdir(join(dir, rec.supermarket), { recursive: true })
    await writeFile(join(dir, rec.supermarket, rec.id + '.html'), HTML)
  }
  return { dir, raw, manifest }
}
async function isolated(fn) {
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-m5-id-contract-'))
  try { await fn(root) } finally {
    await rm(root, { recursive: true, force: true })
  }
}
function run(now, before) {
  const r = spawnSync(process.execPath, [
    '--experimental-strip-types', CLI, now.dir, ...(before ? [before.dir] : []),
  ], { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 })
  assert.equal(r.error, undefined)
  assert.equal(r.signal, null)
  assert.doesNotMatch(r.stdout + r.stderr,
    /fictional-market|example\.invalid|supa-qa-m5-id-contract-|independently invented/)
  return r
}
function manual(r, priority, status) {
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  const json = JSON.parse(r.stdout)
  assert.equal(json.actions.length, 1)
  assert.equal(json.actions[0].priority, priority)
  assert.equal(json.actions[0].status, status)
  assert.equal(json.actions[0].productionEnabled, false)
  for (const key of ['productionReady', 'rightsVerified', 'selectorVerified', 'm5Eligible']) {
    assert.equal(json[key], false, key)
  }
}
async function rejectBeforeHTML(now, before = null) {
  // The earlier valid source intentionally has no HTML. Requiring this exact
  // raw-manifest error prevents silently moving checks after source reads.
  await assert.rejects(
    compareCaptureDirectories(now.dir, before?.dir),
    err => err instanceof Error &&
      err.message === 'Invalid or oversized M1 capture manifest',
  )
  const r = run(now, before)
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, 'Offline review failed: invalid capture or report\n')
  assert.equal(await readFile(now.manifest, 'utf8'), now.raw)
  if (before) assert.equal(await readFile(before.manifest, 'utf8'), before.raw)
}
function pureFailed(id) {
  return captureShape(unavailable(id))
}

test('independent ID: pure P1 permits exactly one ASCII letter', () => {
  assert.equal(pureFailed('a').id, 'a')
})
test('independent ID: pure P1 permits exactly 128 ASCII canonical characters', () => {
  const shape = pureFailed(ID128)
  assert.equal(shape.id, ID128)
  assert.equal(shape.captureStatus, 'unavailable')
})
for (const [label, id] of [
  ['empty', ''], ['129 characters', ID129],
  ['leading dot', '.bad'], ['leading hyphen', '-bad'],
  ['newline', 'foo\nbar'], ['direction override', 'foo\u202ebar'],
  ['composed non-ASCII', 'café'], ['surrogate', 'a\ud800'],
  ['path separator', 'a/b'], ['array', ['ok']], ['null', null],
]) {
  test('independent ID: pure comparator rejects ' + label + ' without echo', () => {
    assert.throws(() => pureFailed(id),
      err => err instanceof Error && err.message === 'Invalid inspected source')
  })
}
test('independent ID: current pure comparison rejects a forged long source before output', () => {
  const input = { sourceCount: 1, sources: [unavailable(ID129)] }
  const snapshot = JSON.stringify(input)
  assert.throws(() => compareInspections(input),
    err => err instanceof Error && err.message === 'Invalid inspected source')
  assert.equal(JSON.stringify(input), snapshot)
})
test('independent ID: historical pure comparison rejects a malformed ID on a failed capture', () => {
  const current = { sourceCount: 0, sources: [] }
  const previous = { sourceCount: 1, sources: [unavailable('a\u202eb')] }
  const snapshot = JSON.stringify(previous)
  assert.throws(() => compareInspections(current, previous),
    err => err instanceof Error && err.message === 'Invalid inspected source')
  assert.equal(JSON.stringify(previous), snapshot)
})
test('independent ID: 128-byte successful source remains human P2', async () => {
  await isolated(async root => {
    const now = await fixture(root, 'now', [row(ID128)], true)
    manual(run(now), 'P2', 'baseline_missing')
    assert.equal(await readFile(now.manifest, 'utf8'), now.raw)
  })
})
test('independent ID: 128-byte unavailable source stays P1 without HTML or SHA', async () => {
  await isolated(async root => {
    const now = await fixture(root, 'now', [unavailable(ID128)])
    manual(run(now), 'P1', 'unavailable')
  })
})
test('independent ID: 128-byte independent historical capture stays human P3', async () => {
  await isolated(async root => {
    const now = await fixture(root, 'now', [row(ID128)], true)
    const before = await fixture(root, 'before',
      [row(ID128, { capturedAt: '2026-10-13T00:00:00.000Z' })], true)
    manual(run(now, before), 'P3', 'unchanged')
  })
})
test('independent ID: late 129-byte current P1 refused before missing first HTML', async () => {
  await isolated(async root => {
    const now = await fixture(root, 'now', [row(), unavailable(ID129)])
    await rejectBeforeHTML(now)
  })
})
test('independent ID: late 129-byte current successful row refused before HTML', async () => {
  await isolated(async root => {
    const now = await fixture(root, 'now', [row(), row(ID129)])
    await rejectBeforeHTML(now)
  })
})
test('independent ID: late 129-byte baseline failed row refused before current HTML', async () => {
  await isolated(async root => {
    const now = await fixture(root, 'now', [row()])
    const before = await fixture(root, 'before', [
      row('good-source', { capturedAt: '2026-10-13T00:00:00.000Z' }),
      unavailable(ID129),
    ])
    await rejectBeforeHTML(now, before)
  })
})
test('independent ID: late 129-byte baseline successful row refused before current HTML', async () => {
  await isolated(async root => {
    const now = await fixture(root, 'now', [row()])
    const before = await fixture(root, 'before', [
      row('good-source', { capturedAt: '2026-10-13T00:00:00.000Z' }),
      row(ID129, { capturedAt: '2026-10-13T00:00:00.000Z' }),
    ])
    await rejectBeforeHTML(now, before)
  })
})
