import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  compareCaptureDirectories, readBoundedManifest,
} from '../scripts/m5-compare-capture-signatures.mjs'

// Only fictional local source data. No real retailer, customers or HTTP.
const cli = fileURLToPath(new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url))
const html = '<!doctype html><html><body>fictional offline source</body></html>'
const sha256 = createHash('sha256').update(html).digest('hex')
const record = (id, extra = {}) => ({
  id, supermarket: 'imaginary-store', kind: 'product', success: true,
  requestedUrl: 'https://example.invalid/PAYLOAD',
  capturedAt: '2026-10-13T12:00:00.000Z', sha256, ...extra,
})
const BAD = Buffer.from('PAYLOAD', 'utf8')
const invalidForms = [
  ['invalid-continuation', Buffer.from([0xc3, 0x28])],
  ['truncated-sequence', Buffer.from([0xe2, 0x82])],
  ['overlong-codepoint', Buffer.from([0xc0, 0xaf])],
  ['utf8-surrogate', Buffer.from([0xed, 0xa0, 0x80])],
  ['out-of-unicode-range', Buffer.from([0xf4, 0x90, 0x80, 0x80])],
  ['stray-continuation', Buffer.from([0x80])],
  ['invalid-ff-byte', Buffer.from([0xff])],
]

async function scoped(run) {
  const root = await mkdtemp(join(tmpdir(), 'supa-product-fatal-utf8-'))
  try { await run(root) }
  finally { await rm(root, { recursive: true, force: true }) }
}

async function create(root, name, rows, { invalid = null, withHtml = false, bom = false } = {}) {
  const directory = join(root, name)
  await mkdir(directory)
  if (withHtml) {
    await mkdir(join(directory, 'imaginary-store'))
    for (const source of rows) {
      if (source.success) {
        await writeFile(join(directory, 'imaginary-store', source.id + '.html'), html)
      }
    }
  }
  const payload = {
    milestone: 'M1 Data Feasibility', bounded: true,
    sourceCount: rows.length, results: rows,
  }
  let raw = Buffer.from(JSON.stringify(payload), 'utf8')
  if (invalid !== null) {
    const at = raw.indexOf(BAD)
    assert.notEqual(at, -1)
    raw = Buffer.concat([
      raw.subarray(0, at), invalid, raw.subarray(at + BAD.length),
    ])
  }
  if (bom) raw = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), raw])
  const manifest = join(directory, 'manifest.json')
  await writeFile(manifest, raw)
  return { directory, manifest, raw }
}

async function expectEarlyRefusal(now, baseline = null) {
  await assert.rejects(
    () => compareCaptureDirectories(now.directory, baseline?.directory),
    /^Error: Invalid or oversized M1 capture manifest$/,
  )
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types', cli, now.directory,
    ...(baseline ? [baseline.directory] : []),
  ], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 })
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.notEqual(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, 'Offline review failed: invalid capture or report\n')
  assert.doesNotMatch(result.stdout + result.stderr,
    /imaginary-store|example\.invalid|fictional offline source|supa-product-fatal-utf8-/)
  assert.deepEqual(await readFile(now.manifest), now.raw)
  if (baseline) assert.deepEqual(await readFile(baseline.manifest), baseline.raw)
}

for (const [kind, bytes] of invalidForms) {
  test('product manifest encoding: later malformed current requestedUrl ' + kind +
       ' rejects before first successful HTML read', async () => {
    await scoped(async (root) => {
      const now = await create(root, 'now', [record('earlier-ok'), record('bad')], {
        invalid: bytes,
      }) // First successful HTML is intentionally missing.
      await expectEarlyRefusal(now)
    })
  })
}

test('product manifest encoding: bad older capture refused before current HTML', async () => {
  await scoped(async (root) => {
    const now = await create(root, 'now', [record('earlier-ok')])
    const old = await create(root, 'old', [record('earlier-ok', {
      capturedAt: '2026-10-12T12:00:00.000Z',
    })], { invalid: Buffer.from([0xff]) })
    await expectEarlyRefusal(now, old)
  })
})

test('product manifest encoding: BOM remains invalid, never newly accepted', async () => {
  await scoped(async (root) => {
    const now = await create(root, 'now', [record('earlier-ok')], { bom: true })
    await expectEarlyRefusal(now)
  })
})

test('product manifest encoding: canonical valid multibyte UTF-8 crossing descriptor chunk passes P2', async () => {
  await scoped(async (root) => {
    const source = record('valid-unicode')
    source.requestedUrl = 'https://example.invalid/' + 'é'
    const first = JSON.stringify({
      milestone: 'M1 Data Feasibility', bounded: true,
      sourceCount: 1, results: [source],
    })
    const before = Buffer.byteLength(first.slice(0, first.indexOf('é')))
    const padding = (65535 - before % 65536 + 65536) % 65536
    source.requestedUrl = 'https://example.invalid/' + 'x'.repeat(padding) + 'é'
    const now = await create(root, 'now', [source], { withHtml: true })
    const found = now.raw.indexOf(Buffer.from([0xc3, 0xa9]))
    assert.equal(found % 65536, 65535) // two UTF-8 bytes cross read boundary
    const report = await compareCaptureDirectories(now.directory)
    assert.equal(report.captureCount, 1)
    assert.equal(report.changes[0].status, 'baseline_missing')
    assert.equal(report.productionReady, false)
    assert.equal(report.m5Eligible, false)
    assert.deepEqual(await readFile(now.manifest), now.raw)
  })
})

test('product manifest encoding: valid multibyte historical source remains P3', async () => {
  await scoped(async (root) => {
    const now = await create(root, 'now', [record('same-id', {
      requestedUrl: 'https://example.invalid/café',
    })], { withHtml: true })
    const old = await create(root, 'old', [record('same-id', {
      requestedUrl: 'https://example.invalid/café',
      capturedAt: '2026-10-12T12:00:00.000Z',
    })], { withHtml: true })
    const result = await compareCaptureDirectories(now.directory, old.directory)
    assert.equal(result.changes[0].status, 'unchanged')
    assert.equal(result.productionReady, false)
    assert.equal(result.m5Eligible, false)
  })
})

test('product manifest encoding: failed P1 without HTML or SHA remains safe', async () => {
  await scoped(async (root) => {
    const now = await create(root, 'now', [{
      id: 'failed-1', supermarket: 'imaginary-store', kind: 'product',
      success: false, requestedUrl: 'https://example.invalid/café',
    }])
    const result = await compareCaptureDirectories(now.directory)
    assert.equal(result.changes[0].status, 'unavailable')
    assert.equal(result.productionReady, false)
    assert.equal(result.m5Eligible, false)
  })
})

test('product manifest encoding: bounded mock reader fails invalid trailing bytes', async () => {
  const bytes = Buffer.concat([
    Buffer.from('{"safe":"prefix-'),
    Buffer.from([0xed, 0xa0, 0x80]),
    Buffer.from('"}'),
  ])
  let offset = 0
  const reader = { async read(buf, at, length) {
    const n = Math.min(length, bytes.length - offset, 2)
    bytes.copy(buf, at, offset, offset + n)
    offset += n
    return { bytesRead: n }
  } }
  await assert.rejects(() => readBoundedManifest(reader), TypeError)
  assert.equal(offset, bytes.length)
})
