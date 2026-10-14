import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  compareCaptureDirectories,
  readBoundedManifest,
} from '../scripts/m5-compare-capture-signatures.mjs'

const cli = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const MiB = 1024 * 1024
const LIMIT = 8 * MiB

class SyntheticGrowingReader {
  constructor(bytes) {
    this.bytes = bytes
    this.position = 0
    this.maxRequested = 0
    this.calls = 0
  }

  async read(destination, offset, length, position) {
    assert.equal(position, null)
    this.maxRequested = Math.max(this.maxRequested, length)
    this.calls += 1
    const count = Math.min(length, this.bytes.length - this.position)
    this.bytes.copy(destination, offset, this.position, this.position + count)
    this.position += count
    return { bytesRead: count, buffer: destination }
  }
}

async function capture(root, name, targetSize, at = '2026-10-13T12:00:00.000Z') {
  const directory = join(root, name)
  await mkdir(directory)
  const manifest = join(directory, 'manifest.json')
  const original = JSON.stringify({
    milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
    results: [{
      id: 'invented', supermarket: 'fictional-store', kind: 'product',
      success: false, capturedAt: at,
    }],
  })
  assert.ok(original.length < targetSize)
  const raw = original + ' '.repeat(targetSize - original.length)
  await writeFile(manifest, raw)
  return { directory, manifest, raw }
}

function cliRun(now, before = null) {
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types', cli, now.directory,
    ...(before ? [before.directory] : []),
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 20_000 })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.doesNotMatch(result.stdout + result.stderr,
    /invented|fictional-store|supa-product-bounded-read/)
  return result
}
function denied(result) {
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, 'Offline review failed: invalid capture or report\n')
}

test('product: descriptor stream reads a short valid UTF-8 value losslessly', async () => {
  const bytes = Buffer.from('{"utf8":"één"}', 'utf8')
  const handle = new SyntheticGrowingReader(bytes)
  assert.equal(await readBoundedManifest(handle), bytes.toString('utf8'))
  assert.equal(handle.position, bytes.length)
  assert.ok(handle.maxRequested <= 64 * 1024)
})

test('product: streaming reader accepts exactly 8 MiB without discarding bytes', async () => {
  const bytes = Buffer.alloc(LIMIT, 0x20)
  const handle = new SyntheticGrowingReader(bytes)
  const result = await readBoundedManifest(handle)
  assert.equal(Buffer.byteLength(result, 'utf8'), LIMIT)
  assert.equal(handle.position, LIMIT)
  assert.ok(handle.maxRequested <= 64 * 1024)
})

test('product: fstat-small but growing stream refuses on byte 8MiB+1, not after reading whole 16MiB', async () => {
  const huge = Buffer.alloc(16 * MiB, 0x20)
  const handle = new SyntheticGrowingReader(huge)
  await assert.rejects(() => readBoundedManifest(handle),
    /^Error: Invalid or oversized M1 capture manifest$/)
  assert.equal(handle.position, LIMIT + 1)
  assert.ok(handle.maxRequested <= 64 * 1024)
  assert.ok(handle.calls < 140, 'must stop reading as soon as byte limit is exceeded')
})

test('product: zero length streaming input does not hang or throw during read', async () => {
  const handle = new SyntheticGrowingReader(Buffer.alloc(0))
  assert.equal(await readBoundedManifest(handle), '')
  assert.equal(handle.calls, 1)
})

test('product: exact 8 MiB real manifest remains private unavailable P1', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-bounded-read-'))
  try {
    const now = await capture(root, 'current', LIMIT)
    const report = await compareCaptureDirectories(now.directory)
    assert.equal(report.changes.length, 1)
    assert.equal(report.changes[0].status, 'unavailable')
    assert.equal(report.productionReady, false)
    assert.equal(report.m5Eligible, false)
    assert.equal(await readFile(now.manifest, 'utf8'), now.raw)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: oversized 8MiB+1 real current manifest refuses before a review queue', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-bounded-read-'))
  try {
    const now = await capture(root, 'current', LIMIT + 1)
    denied(cliRun(now))
    assert.equal(await readFile(now.manifest, 'utf8'), now.raw)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('product: oversized historical manifest refuses whole comparison with current valid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-bounded-read-'))
  try {
    const now = await capture(root, 'current', 1024)
    const before = await capture(root, 'older', LIMIT + 1,
      '2026-10-12T12:00:00.000Z')
    denied(cliRun(now, before))
    assert.equal(await readFile(now.manifest, 'utf8'), now.raw)
    assert.equal(await readFile(before.manifest, 'utf8'), before.raw)
  } finally { await rm(root, { recursive: true, force: true }) }
})
