import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// All captures are fictional and local. No retailer requests or source rights.
const SHA = 'a'.repeat(64)
const observed = (overrides = {}) => ({
  id: 'fictional-id', supermarket: 'fictional-market', kind: 'product',
  success: true, integrity: 'verified', manifestSha256: SHA,
  html: { hasNextData: false, jsonLd: [], applicationJsonScripts: [] },
  schemaOrgProduct: { type: 'abstain' }, ...overrides,
})
const inspection = source => ({ sourceCount: 1, sources: [source] })
const compare = (now, before) => compareInspections(inspection(now), inspection(before))

test('valid M1 source origins remain opaque and unchanged only for identical metadata', () => {
  for (const kind of ['product', 'catalog', 'offers', 'category']) {
    const one = observed({ kind })
    const before = structuredClone(one)
    const result = compare(one, before)
    assert.equal(result.changes[0].status, 'unchanged')
    assert.equal(result.driftCount, 0)
    const queue = buildOfflineSelectorReviewQueue(result)
    assert.equal(queue.actions[0].priority, 'P3')
    assert.equal(queue.productionReady, false)
    assert.equal(queue.rightsVerified, false)
    assert.equal(queue.m5Eligible, false)
    assert.deepEqual(one, before)
    assert.doesNotMatch(JSON.stringify(queue), /fictional-id|fictional-market/)
  }
})

test('malformed supermarket or kind fails closed in both verified and unavailable M1 inputs', () => {
  const invalid = [
    undefined, null, false, 3, {}, [], '', ' extra',
    'dot/relative', 'bad\\origin', 'bad\nsource', 'bad\rsource',
    'bad\u202e', 'a'.repeat(129), '\uD800',
  ]
  for (const field of ['supermarket', 'kind']) {
    for (const value of invalid) {
      for (const available of [true, false]) {
        const source = observed({ [field]: value, success: available })
        const original = structuredClone(source)
        assert.throws(() => captureShape(source), /^Error: Invalid inspected source origin$/,
          field + ': ' + typeof value)
        assert.throws(() => compare(source, observed()),
          /^Error: Invalid inspected source origin$/)
        assert.deepEqual(source, original)
      }
    }
  }
})

test('changing canonical origin remains P1 and unchanged hashes never bypass it', () => {
  const before = observed()
  const after = observed({ supermarket: 'another-market', kind: 'catalog' })
  const result = compare(after, before)
  assert.equal(result.changes[0].status, 'origin_changed')
  assert.equal(result.driftCount, 1)
  assert.equal(buildOfflineSelectorReviewQueue(result).actions[0].priority, 'P1')
})

test('failed original SHA verification remains an integrity error before origin review', () => {
  const source = observed({ integrity: 'unchecked', supermarket: undefined })
  assert.throws(() => captureShape(source), /Snapshot integrity verification required/)
})

test('real offline review CLI refuses missing kind with generic diagnostic and zero stdout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-origin-missing-'))
  try {
    const html = '<!doctype html><html><body>fictional offline only</body></html>'
    const store = join(root, 'fictional-market')
    await mkdir(store)
    await writeFile(join(store, 'fictional-id.html'), html)
    const raw = JSON.stringify({
      milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
      results: [{
        id: 'fictional-id', supermarket: 'fictional-market',
        // Kind is missing: an apparently intact hash cannot certify origin.
        success: true, requestedUrl: 'https://example.invalid/no-network',
        capturedAt: '2026-10-13T00:00:00.000Z',
        sha256: createHash('sha256').update(html).digest('hex'),
      }],
    })
    const path = join(root, 'manifest.json')
    await writeFile(path, raw)
    const cli = new URL('../scripts/m5-build-selector-review-queue.mjs', import.meta.url).pathname
    const result = spawnSync(process.execPath,
      ['--experimental-strip-types', cli, root],
      { encoding: 'utf8', timeout: 10000 })
    assert.notEqual(result.status, 0)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /Offline review failed: invalid capture or report/)
    assert.doesNotMatch(result.stderr, /fictional-id|fictional-market|example.invalid|supa-m5-origin-missing/)
    assert.equal(await readFile(path, 'utf8'), raw)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
