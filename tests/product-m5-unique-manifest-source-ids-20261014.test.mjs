import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { compareCaptureDirectories } from '../scripts/m5-compare-capture-signatures.mjs'

const cli = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const html = '<!doctype html><html><body>fictional offline source</body></html>'
const sha = createHash('sha256').update(html).digest('hex')

async function fixture(root, dirName, records, { includeHtml = true, capturedAt = '2026-10-13T12:00:00.000Z' } = {}) {
  const directory = join(root, dirName)
  await mkdir(directory, { recursive: true })
  const manifestRows = []
  const written = new Set()
  for (const entry of records) {
    const store = entry.supermarket ?? 'invented-store'
    const source = {
      id: entry.id, supermarket: store, kind: 'product',
      success: entry.success ?? true,
      requestedUrl: 'https://example.invalid/private',
      ...(entry.success === false ? {} : { sha256: sha, capturedAt }),
    }
    manifestRows.push(source)
    if (includeHtml && source.success && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(source.id)) {
      await mkdir(join(directory, store), { recursive: true })
      const file = join(directory, store, source.id + '.html')
      if (!written.has(file)) await writeFile(file, html)
      written.add(file)
    }
  }
  const raw = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: manifestRows.length, results: manifestRows,
  })
  await writeFile(join(directory, 'manifest.json'), raw)
  return { directory, raw }
}

function cliRun(now, baseline = null) {
  const r = spawnSync(process.execPath, [
    '--experimental-strip-types', cli, now.directory,
    ...(baseline ? [baseline.directory] : []),
  ], { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 })
  assert.equal(r.error, undefined)
  assert.equal(r.signal, null)
  assert.doesNotMatch(r.stdout + r.stderr,
    /invented-|example\.invalid|fictional offline|supa-product-unique-m1-ids/)
  return r
}

async function assertUnchanged(...captures) {
  for (const f of captures) {
    assert.equal(await readFile(join(f.directory, 'manifest.json'), 'utf8'), f.raw)
  }
}

async function rejectedBeforeInspection(now, baseline = null) {
  await assert.rejects(() => compareCaptureDirectories(now.directory, baseline?.directory),
    /^Error: Invalid or oversized M1 capture manifest$/)
  const r = cliRun(now, baseline)
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, 'Offline review failed: invalid capture or report\n')
  await assertUnchanged(now, ...(baseline ? [baseline] : []))
}

test('product: two independent canonical source IDs remain P2 manual only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-unique-m1-ids-'))
  try {
    const current = await fixture(root, 'now', [{ id: 'one' }, { id: 'two' }])
    const report = await compareCaptureDirectories(current.directory)
    assert.equal(report.captureCount, 2)
    assert.deepEqual(report.changes.map(x => x.status), ['baseline_missing', 'baseline_missing'])
    assert.equal(report.productionReady, false)
    assert.equal(report.m5Eligible, false)
    await assertUnchanged(current)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: legitimately shared ID across different time-ordered roots remains private P3', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-unique-m1-ids-'))
  try {
    const current = await fixture(root, 'now', [{ id: 'one' }])
    const before = await fixture(root, 'prior', [{ id: 'one' }], { capturedAt: '2026-10-12T12:00:00.000Z' })
    const report = await compareCaptureDirectories(current.directory, before.directory)
    assert.equal(report.changes[0].status, 'unchanged')
    assert.equal(report.baselineProvided, true)
    assert.equal(report.productionReady, false)
    assert.equal(report.m5Eligible, false)
    await assertUnchanged(current, before)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: duplicate successful source IDs are rejected before missing HTML inspection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-unique-m1-ids-'))
  try {
    const current = await fixture(root, 'now', [{ id: 'same' }, { id: 'same' }], { includeHtml: false })
    await rejectedBeforeInspection(current)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: duplicate P1 unavailable source identities are rejected in preflight', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-unique-m1-ids-'))
  try {
    const current = await fixture(root, 'now', [{ id: 'failed', success: false }, { id: 'failed', success: false }], { includeHtml: false })
    await rejectedBeforeInspection(current)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: duplicate historical manifest is rejected before current HTML reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-unique-m1-ids-'))
  try {
    const now = await fixture(root, 'now', [{ id: 'same' }], { includeHtml: false })
    const prior = await fixture(root, 'prior', [{ id: 'same' }, { id: 'same' }], { includeHtml: false, capturedAt: '2026-10-12T12:00:00.000Z' })
    await rejectedBeforeInspection(now, prior)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: repeated IDs across different supermarket folders remain one ambiguous identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-unique-m1-ids-'))
  try {
    const current = await fixture(root, 'now', [
      { id: 'same', supermarket: 'first' },
      { id: 'same', supermarket: 'second' },
    ], { includeHtml: false })
    await rejectedBeforeInspection(current)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: unsafe raw source identifier is refused before attempting source path read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-unique-m1-ids-'))
  try {
    const current = await fixture(root, 'now', [{ id: '../outside' }], { includeHtml: false })
    await rejectedBeforeInspection(current)
  } finally { await rm(root, { recursive: true, force: true }) }
})
