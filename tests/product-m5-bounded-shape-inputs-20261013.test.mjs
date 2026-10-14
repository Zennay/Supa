import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

const source = () => ({
  id: 'fictional-source', supermarket: 'fictional-store', kind: 'product',
  success: true, integrity: 'verified', manifestSha256: 'a'.repeat(64),
  schemaOrgProduct: { type: 'abstain' },
  html: { hasNextData: false, jsonLd: [], applicationJsonScripts: [] },
})
const inspect = (s) => ({ sourceCount: 1, sources: [s] })
const compare = (now, before) => compareInspections(inspect(now), inspect(before))

test('valid bounded fingerprint remains deterministic and manual-only', () => {
  const input = source()
  input.html.jsonLd = Array.from({ length: 128 }, (_, i) =>
    ({ type: i === 0 ? ['Product'] : [], keys: i === 0 ? ['offers', '@type'] : [] }))
  input.html.applicationJsonScripts = Array.from({ length: 128 }, () => ({ id: null, bytes: 0 }))
  // This changed synthetic HTML must also have a different verified source SHA.
  input.manifestSha256 = 'b'.repeat(64)
  const frozen = structuredClone(input)
  const report = compare(input, source())
  assert.equal(report.changes[0].status, 'shape_changed')
  assert.equal(report.changes[0].current.jsonLdCount, 128)
  assert.equal(buildOfflineSelectorReviewQueue(report).actions[0].priority, 'P1')
  assert.equal(report.m5Eligible, false)
  assert.equal(report.productionReady, false)
  assert.deepEqual(input, frozen)
  assert.equal(compare(source(), source()).changes[0].status, 'unchanged')
})

test('unbounded record counts, terms and overly long values fail closed', () => {
  for (const mutate of [
    s => { s.html.jsonLd = Array.from({ length: 129 }, () => ({ type: [], keys: [] })) },
    s => { s.html.applicationJsonScripts = Array(129).fill({ id: null, bytes: 0 }) },
    s => { s.html.jsonLd = [{ type: Array(257).fill('Product'), keys: [] }] },
    s => { s.html.jsonLd = [{ type: [], keys: Array(257).fill('offers') }] },
    s => { s.html.jsonLd = [{ type: ['x'.repeat(257)], keys: [] }] },
    s => { s.html.jsonLd = [{ type: [], keys: ['x'.repeat(257)] }] },
  ]) {
    const input = source()
    mutate(input)
    const frozen = structuredClone(input)
    assert.throws(() => captureShape(input), /Invalid or unbounded inspected HTML shape/)
    assert.throws(() => compare(input, source()), /Invalid or unbounded inspected HTML shape/)
    assert.deepEqual(input, frozen)
  }
})

test('malformed and sparse inspected arrays cannot silently fingerprint as empty', () => {
  for (const mutate of [
    s => { s.html.jsonLd = [null] },
    s => { s.html.jsonLd = [{}] },
    s => { s.html.jsonLd = [{ type: null, keys: [] }] },
    s => { s.html.jsonLd = [{ type: [null], keys: [] }] },
    s => { s.html.jsonLd = [{ type: [], keys: ['price', null] }] },
    s => { s.html.jsonLd = new Array(2) },
    s => { s.html.jsonLd = [{ type: new Array(1), keys: [] }] },
    s => { s.html.applicationJsonScripts = new Array(2) },
    s => { s.html.applicationJsonScripts = [null] },
  ]) {
    const input = source()
    mutate(input)
    assert.throws(() => captureShape(input), /Invalid or unbounded inspected HTML shape/)
  }
})

test('real offline CLI rejects 129 verified JSON-LD blocks without stdout or private diagnostics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-overflow-'))
  try {
    const dir = join(root, 'fictional-store')
    await mkdir(dir)
    const html = '<html><head>' + Array.from({ length: 129 }, () =>
      '<script type="application/ld+json">{"@type":"Product"}</script>').join('') + '</head></html>'
    await writeFile(join(dir, 'fictional-source.html'), html)
    const manifest = JSON.stringify({
      milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
      results: [{ id: 'fictional-source', supermarket: 'fictional-store', kind: 'product',
        success: true, requestedUrl: 'https://example.invalid/fake',
        capturedAt: '2026-10-13T00:00:00.000Z',
        sha256: createHash('sha256').update(html).digest('hex') }],
    })
    const file = join(root, 'manifest.json')
    await writeFile(file, manifest)
    const cli = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname
    const result = spawnSync(process.execPath, ['--experimental-strip-types', cli, root],
      { encoding: 'utf8', timeout: 10000 })
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /Offline review failed: invalid capture or report/)
    assert.doesNotMatch(result.stderr, /fictional-store|fictional-source|example.invalid|supa-m5-overflow/)
    assert.equal(await readFile(file, 'utf8'), manifest)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
