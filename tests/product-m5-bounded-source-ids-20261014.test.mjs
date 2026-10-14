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

// Product-only synthetic suite. No real retailer, account, URL or price.
const cli = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const html = '<!doctype html><html><body>fictional captured markup</body></html>'
const sha256 = createHash('sha256').update(html).digest('hex')
const id128 = 'a'.repeat(128)
const id129 = 'a'.repeat(129)
const row = (id, extra = {}) => ({
  id, supermarket: 'fictional-store', kind: 'product',
  success: true, requestedUrl: 'https://example.invalid/research',
  sha256, capturedAt: '2026-10-13T12:00:00.000Z', ...extra,
})

async function capture(root, name, rows, withHtml = false) {
  const dir = join(root, name)
  await mkdir(dir)
  if (withHtml) {
    await mkdir(join(dir, 'fictional-store'))
    for (const entry of rows) {
      if (entry.success && entry.supermarket === 'fictional-store' &&
          /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.id)) {
        await writeFile(join(dir, 'fictional-store', entry.id + '.html'), html)
      }
    }
  }
  const manifest = join(dir, 'manifest.json')
  const raw = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: rows.length, results: rows,
  })
  await writeFile(manifest, raw)
  return { dir, manifest, raw }
}

async function isolated(run) {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-canonical-ids-'))
  try { await run(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

function privateCli(now, older = null) {
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types', cli, now.dir, ...(older ? [older.dir] : []),
  ], { encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024 })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.doesNotMatch(result.stdout + result.stderr,
    /fictional-store|example\.invalid|fictional captured markup|supa-m5-canonical-ids-/)
  return result
}

async function invalidEarly(now, older = null) {
  await assert.rejects(
    () => compareCaptureDirectories(now.dir, older?.dir),
    /^Error: Invalid or oversized M1 capture manifest$/,
  )
  const response = privateCli(now, older)
  assert.notEqual(response.status, 0)
  assert.equal(response.stdout, '')
  assert.equal(response.stderr, 'Offline review failed: invalid capture or report\n')
  assert.equal(await readFile(now.manifest, 'utf8'), now.raw)
  if (older) assert.equal(await readFile(older.manifest, 'utf8'), older.raw)
}

test('product identity: pure P1 accepts exactly 128 ASCII source-id chars', () => {
  const shape = captureShape({
    id: id128, supermarket: 'fictional-store', kind: 'product', success: false,
  })
  assert.equal(shape.id, id128)
  assert.equal(shape.captureStatus, 'unavailable')
  const result = compareInspections({ sources: [{
    id: id128, supermarket: 'fictional-store', kind: 'product', success: false,
  }], sourceCount: 1 })
  assert.equal(result.changes[0].status, 'unavailable')
  assert.equal(result.m5Eligible, false)
})

test('product identity: pure API rejects Unicode, control, path and overlong IDs', () => {
  for (const id of ['', null, id129, 'é', 'a\nb', 'a/b', 'a\u202eb']) {
    assert.throws(() => captureShape({
      id, supermarket: 'fictional-store', kind: 'product', success: false,
    }), /^Error: Invalid inspected source$/)
  }
})

test('product identity: pure API rejects invalid historical ID before classification', () => {
  const current = { sourceCount: 0, sources: [] }
  const baseline = { sourceCount: 1, sources: [{
    id: id129, supermarket: 'fictional-store', kind: 'product', success: false,
  }] }
  assert.throws(() => compareInspections(current, baseline),
    /^Error: Invalid inspected source$/)
})

test('product identity: 128-char success retains private P2 without claiming M5', async () => {
  await isolated(async (root) => {
    const now = await capture(root, 'now', [row(id128)], true)
    const report = await compareCaptureDirectories(now.dir)
    assert.equal(report.captureCount, 1)
    assert.equal(report.changes[0].status, 'baseline_missing')
    assert.equal(report.productionReady, false)
    assert.equal(report.m5Eligible, false)
  })
})

test('product identity: normal P1 remains unavailable without SHA or HTML', async () => {
  await isolated(async (root) => {
    const now = await capture(root, 'now', [{
      id: 'failed-1', supermarket: 'fictional-store', kind: 'product',
      success: false,
    }])
    const report = await compareCaptureDirectories(now.dir)
    assert.equal(report.changes[0].status, 'unavailable')
    assert.equal(report.m5Eligible, false)
  })
})

test('product identity: independent same-source earlier capture remains private P3', async () => {
  await isolated(async (root) => {
    const now = await capture(root, 'now', [row('good')], true)
    const old = await capture(root, 'old', [
      row('good', { capturedAt: '2026-10-12T12:00:00.000Z' }),
    ], true)
    const report = await compareCaptureDirectories(now.dir, old.dir)
    assert.equal(report.changes[0].status, 'unchanged')
    assert.equal(report.m5Eligible, false)
    assert.equal(report.productionReady, false)
  })
})

test('product identity: later too-long P1 rejects before earlier HTML read', async () => {
  await isolated(async (root) => {
    const now = await capture(root, 'now', [
      row('earlier-good'), row(id129, { success: false, sha256: undefined }),
    ]) // Deliberately no HTML for first successful source.
    await invalidEarly(now)
  })
})

test('product identity: later too-long successful ID rejects before HTML read', async () => {
  await isolated(async (root) => {
    const now = await capture(root, 'now', [row('earlier-good'), row(id129)])
    await invalidEarly(now)
  })
})

test('product identity: historical too-long P1 rejects before current HTML read', async () => {
  await isolated(async (root) => {
    const now = await capture(root, 'now', [row('earlier-good')])
    const older = await capture(root, 'old', [
      row('earlier-good', { capturedAt: '2026-10-12T12:00:00.000Z' }),
      row(id129, { success: false, sha256: undefined }),
    ])
    await invalidEarly(now, older)
  })
})

test('product identity: non-ASCII P1 in late manifest row cannot enter reviewer', async () => {
  await isolated(async (root) => {
    const now = await capture(root, 'now', [
      row('earlier-good'), row('a\u202eb', { success: false }),
    ])
    await invalidEarly(now)
  })
})
