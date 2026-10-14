import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// All fixtures are invented and remain in memory, no retailer/proxy activity.
const fake = () => ({
  id: 'sample-id', supermarket: 'fictional-market', kind: 'product',
  success: true, integrity: 'verified', manifestSha256: 'a'.repeat(64),
  html: { hasNextData: false, jsonLd: [], applicationJsonScripts: [] },
  schemaOrgProduct: { type: 'abstain' },
})
const inspection = s => ({ sourceCount: 1, sources: [s] })
const compare = (a, b) => compareInspections(inspection(a), inspection(b))
const invalid = /Invalid or unbounded inspected HTML shape/

test('real M1 parser output is canonical, still works with next-data and scripts', () => {
  const synthetic = '<html><head><script id="__NEXT_DATA__" type="application/json">{"x":2}</script>'+
    '<script type="application/ld+json">{"@type":"Product","offers":{}}</script>'+
    '<script type="application/ld+json">broken</script></head></html>'
  const rec = fake()
  rec.html = inspectHtml(synthetic)
  assert.equal(rec.html.hasNextData, true)
  assert.equal(rec.html.jsonLd[1].parseError, true)
  assert.equal(rec.html.applicationJsonScripts.length, 1)
  assert.equal(rec.html.applicationJsonScripts[0].id, '__NEXT_DATA__')
  const before = structuredClone(rec)
  const report = compare(rec, before)
  assert.equal(report.changes[0].status, 'unchanged')
  assert.equal(report.driftCount, 0)
  const queue = buildOfflineSelectorReviewQueue(report)
  assert.equal(queue.actions[0].priority, 'P3')
  assert.equal(queue.m5Eligible, false)
  assert.equal(queue.productionReady, false)
  assert.equal(queue.rightsVerified, false)
  assert.equal(queue.selectorVerified, false)
  assert.deepEqual(rec, before)
  assert.doesNotMatch(JSON.stringify(queue), /sample-id|fictional-market/)
})

test('no synthetic coercion: missing or malformed next-data scalar is never false', () => {
  for (const value of [undefined, null, 'true', 'false', 0, 1, [], {}]) {
    const current = fake()
    current.html.hasNextData = value
    const original = structuredClone(current)
    assert.throws(() => captureShape(current), invalid)
    assert.throws(() => compare(current, fake()), invalid)
    assert.deepEqual(current, original)
  }
  const before = fake()
  const after = fake()
  after.html.hasNextData = true
  const result = compare(after, before)
  assert.equal(result.changes[0].status, 'shape_changed')
  assert.equal(buildOfflineSelectorReviewQueue(result).actions[0].priority, 'P1')
})

test('JSON-LD parseError is canonical true-or-absent, never string/false', () => {
  for (const marker of [null, false, 0, 'true', {}, []]) {
    const rec = fake()
    rec.html.jsonLd = [{ type: [], keys: [], parseError: marker }]
    assert.throws(() => captureShape(rec), invalid)
  }
  const good = fake()
  good.html.jsonLd = [{ type: [], keys: [], parseError: true }]
  assert.equal(captureShape(good).jsonLdParseErrors, 1)
  const absent = fake()
  absent.html.jsonLd = [{ type: [], keys: [] }]
  assert.equal(captureShape(absent).jsonLdParseErrors, 0)
  assert.equal(compare(good, absent).changes[0].status, 'shape_changed')
})

test('application/json descriptors require own id and safe nonnegative byte count', () => {
  const invalidDescriptors = [
    {}, [], { id: null }, { bytes: 0 }, { id: 7, bytes: 0 },
    { id: false, bytes: 0 }, { id: {}, bytes: 0 }, { id: '', bytes: -1 },
    { id: null, bytes: NaN }, { id: null, bytes: Infinity },
    { id: null, bytes: 1.3 }, { id: null, bytes: '2' },
    { id: null, bytes: Number.MAX_SAFE_INTEGER + 1 },
    Object.assign(Object.create({ id: null }), { bytes: 0 }),
    Object.assign(Object.create({ bytes: 0 }), { id: null }),
  ]
  for (const item of invalidDescriptors) {
    const s = fake()
    s.html.applicationJsonScripts = [item]
    assert.throws(() => captureShape(s), invalid, JSON.stringify(item))
  }
  for (const item of [{ id: null, bytes: 0 },
    { id: '', bytes: 0 }, { id: 'script-01', bytes: 124 }]) {
    const s = fake()
    s.html.applicationJsonScripts = [item]
    assert.equal(captureShape(s).captureStatus, 'verified')
  }
})

test('verified hash guard and failed capture P1 remain intact', () => {
  const missingHash = fake()
  missingHash.integrity = 'unchecked'
  missingHash.html = null
  assert.throws(() => captureShape(missingHash),
    /Snapshot integrity verification required/)
  const failed = { id: 'sample-id', supermarket: 'fictional-market',
    kind: 'product', success: false }
  const report = compareInspections(inspection(failed), null)
  assert.equal(report.changes[0].status, 'unavailable')
  assert.equal(buildOfflineSelectorReviewQueue(report).actions[0].priority, 'P1')
})
