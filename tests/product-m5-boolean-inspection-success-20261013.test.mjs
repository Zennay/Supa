import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { inspectCaptureDirectory } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

const source = (success = true) => ({
  id: 'fictional-capture',
  supermarket: 'fictional',
  kind: 'product',
  success,
  ...(success === true
    ? { integrity: 'verified', manifestSha256: 'a'.repeat(64),
      html: { hasNextData: false, jsonLd: [], applicationJsonScripts: [] },
      schemaOrgProduct: { type: 'abstain' } }
    : { integrity: 'not-applicable' }),
})
const inspect = record => ({ sourceCount: 1, sources: [record] })

test('M5 success=true retains verified hash and no automatic approval', () => {
  const a = source(true)
  const previous = structuredClone(a)
  const result = compareInspections(inspect(a), inspect(previous))
  assert.equal(result.changes[0].status, 'unchanged')
  assert.equal(result.changes[0].current.captureStatus, 'verified')
  const queue = buildOfflineSelectorReviewQueue(result)
  assert.equal(queue.actions[0].priority, 'P3')
  assert.equal(queue.rightsVerified, false)
  assert.equal(queue.selectorVerified, false)
  assert.equal(queue.productionReady, false)
  assert.equal(queue.m5Eligible, false)
  assert.deepEqual(a, previous)
})

test('M5 success=false remains unavailable P1 if first or same-ID failed capture', () => {
  const failed = source(false)
  const first = compareInspections(inspect(failed))
  assert.equal(first.changes[0].status, 'unavailable')
  assert.equal(first.driftCount, 1)
  assert.equal(buildOfflineSelectorReviewQueue(first).actions[0].priority, 'P1')
  const known = compareInspections(inspect(failed), inspect(source(true)))
  assert.equal(known.changes[0].status, 'unavailable')
  assert.equal(buildOfflineSelectorReviewQueue(known).actions[0].priority, 'P1')
})

test('M5 pure inspector forbids missing, numeric, string and boxed success claims', () => {
  for (const success of [undefined, null, '', 0, 1, 'false', 'true',
    [], {}, new Boolean(true), new Boolean(false)]) {
    const s = source(true)
    if (success === undefined) delete s.success
    else s.success = success
    const before = structuredClone(s)
    assert.throws(() => captureShape(s), /^Error: Invalid inspected capture success$/)
    assert.throws(() => compareInspections(inspect(s), inspect(source(true))),
      /^Error: Invalid inspected capture success$/)
    assert.deepEqual(s, before)
  }
})

test('M1 inspector produces actual boolean success fields from synthetic local captures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supa-m5-boolean-'))
  try {
    await mkdir(join(root, 'fictional'))
    const html = '<html><body>synthetic offline content</body></html>'
    await writeFile(join(root, 'fictional', 'fictional-capture.html'), html)
    await writeFile(join(root, 'manifest.json'), JSON.stringify({
      milestone: 'M1 Data Feasibility', bounded: true, sourceCount: 1,
      results: [{
        id: 'fictional-capture', supermarket: 'fictional', kind: 'product',
        requestedUrl: 'https://example.invalid/no-network',
        capturedAt: '2026-10-13T00:00:00.000Z', success: true,
        sha256: createHash('sha256').update(html).digest('hex'),
      }],
    }))
    const inspected = await inspectCaptureDirectory(root)
    assert.equal(typeof inspected.sources[0].success, 'boolean')
    assert.equal(inspected.sources[0].success, true)
    const result = compareInspections(inspected, inspected)
    assert.equal(result.changes[0].status, 'unchanged')
    assert.equal(result.productionReady, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
