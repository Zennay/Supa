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
const html = '<!doctype html><body>invented local bytes only</body>'
const sha = createHash('sha256').update(html).digest('hex')
const source = (id, opts = {}) => ({
  id, supermarket: 'pretend-store', kind: 'product', success: true,
  requestedUrl: 'https://example.invalid/nonretail',
  capturedAt: '2026-10-13T12:00:00.000Z', sha256: sha, ...opts,
})

async function fixture(root, name, rows, createHtml = false) {
  const dir = join(root, name)
  await mkdir(dir)
  if (createHtml) {
    await mkdir(join(dir, 'pretend-store'))
    for (const row of rows) {
      if (row.success && row.supermarket === 'pretend-store') {
        await writeFile(join(dir, 'pretend-store', row.id + '.html'), html)
      }
    }
  }
  const manifest = join(dir, 'manifest.json')
  const raw = JSON.stringify({ milestone: 'M1 Data Feasibility',
    bounded: true, sourceCount: rows.length, results: rows })
  await writeFile(manifest, raw)
  return { dir, manifest, raw }
}

function run(now, earlier) {
  const r = spawnSync(process.execPath, [
    '--experimental-strip-types', cli, now.dir,
    ...(earlier ? [earlier.dir] : []),
  ], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
  assert.equal(r.error, undefined)
  assert.equal(r.signal, null)
  assert.doesNotMatch(r.stdout + r.stderr,
    /pretend-store|example\.invalid|invented local|supa-product-sha-shape-/)
  return r
}

async function invalid(now, earlier = null) {
  await assert.rejects(() => compareCaptureDirectories(now.dir, earlier?.dir),
    /^Error: Invalid or oversized M1 capture manifest$/)
  const r = run(now, earlier)
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, 'Offline review failed: invalid capture or report\n')
  assert.equal(await readFile(now.manifest, 'utf8'), now.raw)
  if (earlier) assert.equal(await readFile(earlier.manifest, 'utf8'), earlier.raw)
}

test('product: matching canonical SHA-256 source remains human-only P2', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-sha-shape-'))
  try {
    const c = await fixture(root, 'now', [source('good')], true)
    const result = await compareCaptureDirectories(c.dir)
    assert.equal(result.changes[0].status, 'baseline_missing')
    assert.equal(result.productionReady, false)
    assert.equal(result.m5Eligible, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: unavailable P1 does not require any SHA or HTML file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-sha-shape-'))
  try {
    const c = await fixture(root, 'now', [
      { id: 'failed', supermarket: 'pretend-store', kind: 'product', success: false },
    ])
    const result = await compareCaptureDirectories(c.dir)
    assert.equal(result.changes[0].status, 'unavailable')
    assert.equal(result.m5Eligible, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: independent earlier SHA-verified source remains private P3', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-sha-shape-'))
  try {
    const now = await fixture(root, 'now', [source('good')], true)
    const earlier = await fixture(root, 'old', [source('good', {
      capturedAt: '2026-10-12T12:00:00.000Z',
    })], true)
    const r = await compareCaptureDirectories(now.dir, earlier.dir)
    assert.equal(r.changes[0].status, 'unchanged')
    assert.equal(r.productionReady, false)
    assert.equal(r.m5Eligible, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: missing later success digest rejects before earlier HTML read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-sha-shape-'))
  try {
    const now = await fixture(root, 'now', [
      source('good'), source('bad', { sha256: undefined }),
    ])
    await invalid(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: non-string success digest rejects entire manifest early', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-sha-shape-'))
  try {
    const now = await fixture(root, 'now', [
      source('good'), source('bad', { sha256: { fake: sha } }),
    ])
    await invalid(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: uppercase digest refuses before HTML regardless of valid hex bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-sha-shape-'))
  try {
    const now = await fixture(root, 'now', [
      source('good'), source('bad', { sha256: sha.toUpperCase() }),
    ])
    await invalid(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: too-short digest cannot certify a captured HTML source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-sha-shape-'))
  try {
    const now = await fixture(root, 'now', [
      source('good'), source('bad', { sha256: sha.slice(0, 63) }),
    ])
    await invalid(now)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: malformed historical SHA blocks all reports before current HTML read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-sha-shape-'))
  try {
    const now = await fixture(root, 'now', [source('good')])
    const earlier = await fixture(root, 'old', [source('good', {
      capturedAt: '2026-10-12T12:00:00.000Z',
      sha256: 'not-an-integrity-digest',
    })])
    await invalid(now, earlier)
  } finally { await rm(root, { recursive: true, force: true }) }
})
