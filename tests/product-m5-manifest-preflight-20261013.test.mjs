import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { compareCaptureDirectories } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

const fake = (sources = [{ id: 'fictional-id', supermarket: 'fictional', kind: 'product',
  success: false }]) => ({
  milestone: 'M1 Data Feasibility', bounded: true,
  sourceCount: sources.length, results: sources,
})
const temporary = async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-preflight-'))
  return { root, filename: join(root, 'manifest.json') }
}
const err = /Invalid or oversized M1 capture manifest/

test('one valid failed M1 capture still produces conservative P1 offline manual action', async () => {
  const { root, filename } = await temporary()
  try {
    const raw = JSON.stringify(fake())
    await writeFile(filename, raw)
    const result = await compareCaptureDirectories(root)
    assert.equal(result.captureCount, 1)
    assert.equal(result.driftCount, 1)
    assert.equal(result.changes[0].status, 'unavailable')
    const queue = buildOfflineSelectorReviewQueue(result)
    assert.equal(queue.actions[0].priority, 'P1')
    assert.equal(queue.rightsVerified, false)
    assert.equal(queue.selectorVerified, false)
    assert.equal(queue.productionReady, false)
    assert.equal(queue.m5Eligible, false)
    assert.equal(await readFile(filename, 'utf8'), raw)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('oversized result array is refused before visiting any fictional HTML capture', async () => {
  const { root, filename } = await temporary()
  try {
    const results = Array.from({ length: 101 }, (_, i) => ({
      id: 'missing-html-' + i, supermarket: 'fictional',
      kind: 'product', success: true, sha256: 'a'.repeat(64),
    }))
    await writeFile(filename, JSON.stringify(fake(results)))
    await assert.rejects(() => compareCaptureDirectories(root), err)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('baseline manifest is also checked before reading current M1 HTML', async () => {
  const current = await temporary()
  const baseline = await temporary()
  try {
    await writeFile(current.filename, JSON.stringify(fake([
      { id: 'missing-current-html', supermarket: 'fictional', kind: 'product',
        success: true, sha256: 'a'.repeat(64) },
    ])))
    await writeFile(baseline.filename, JSON.stringify(fake(
      Array.from({ length: 101 }, (_, i) => ({
        id: 'baseline-' + i, supermarket: 'fictional', kind: 'product',
        success: false,
      })),
    )))
    await assert.rejects(
      () => compareCaptureDirectories(current.root, baseline.root), err)
  } finally {
    await rm(current.root, { recursive: true, force: true })
    await rm(baseline.root, { recursive: true, force: true })
  }
})

test('malformed and unbounded preflight metadata are generic errors without destructive writes', async () => {
  const { root, filename } = await temporary()
  try {
    for (const invalid of [
      { ...fake(), bounded: false }, { ...fake(), sourceCount: 2 },
      { ...fake(), sourceCount: '1' }, { ...fake(), milestone: 'M5' },
      { ...fake(), results: {} }, null, [],
    ]) {
      const raw = JSON.stringify(invalid)
      await writeFile(filename, raw)
      await assert.rejects(() => compareCaptureDirectories(root), err)
      assert.equal(await readFile(filename, 'utf8'), raw)
    }
    await writeFile(filename, '{broken JSON')
    await assert.rejects(() => compareCaptureDirectories(root), err)
    await rm(filename)
    await assert.rejects(() => compareCaptureDirectories(root), err)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('8 MiB manifest size ceiling protects offline M5 preflight from excessive JSON files', async () => {
  const { root, filename } = await temporary()
  try {
    const raw = JSON.stringify({ ...fake(), ignored: 'x'.repeat(8 * 1024 * 1024) })
    await writeFile(filename, raw)
    assert.ok(Buffer.byteLength(raw) > 8 * 1024 * 1024)
    await assert.rejects(() => compareCaptureDirectories(root), err)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
