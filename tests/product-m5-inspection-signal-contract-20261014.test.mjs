import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHAPE_A = 'c'.repeat(64)
const SHAPE_B = 'd'.repeat(64)
const verified = (id, options = {}) => ({
  id, supermarket: 'fictional-shop', kind: 'product', captureStatus: 'verified',
  snapshotSha256: SHA_A, shapeSha256: SHAPE_A, schemaOrgStatus: 'abstain',
  hasNextData: false, jsonLdCount: 0, jsonLdParseErrors: 0, ...options,
})
const failed = (id) => ({
  id, supermarket: 'fictional-shop', kind: 'product', captureStatus: 'unavailable',
  snapshotSha256: null, shapeSha256: null, schemaOrgStatus: 'unknown',
})
const line = (id, status, current, baseline = null) => ({
  id, status, current, baseline,
})
const drift = new Set(['added', 'removed', 'unavailable', 'shape_changed', 'origin_changed'])
const report = (changes, baselineProvided = true) => ({
  contractVersion: 1, mode: 'offline_capture_signature_review_only',
  baselineProvided, productionReady: false, m5Eligible: false,
  reviewerActionRequired: true,
  captureCount: changes.filter(x => x.current !== null).length,
  driftCount: changes.filter(x => drift.has(x.status)).length, changes,
})
const refuse = (candidate) => {
  const frozen = structuredClone(candidate)
  assert.throws(() => buildOfflineSelectorReviewQueue(candidate),
    /^Error: Invalid offline capture comparison report$/)
  assert.deepEqual(candidate, frozen)
}

test('M5 inspection counts: verified snapshot with missing own hasNextData is rejected', () => {
  const id = 'missing-boolean'
  const current = verified(id)
  delete current.hasNextData
  refuse(report([line(id, 'baseline_missing', current)], false))
})

test('M5 inspection counts: nonboolean next-data never coerced into false', () => {
  const id = 'wrong-boolean'
  for (const hasNextData of [null, 0, 1, 'false', 'true', [], {}]) {
    refuse(report([line(id, 'baseline_missing', verified(id, { hasNextData }))], false))
  }
})

test('M5 inspection counts: required count fields cannot be missing or inherited', () => {
  for (const key of ['jsonLdCount', 'jsonLdParseErrors']) {
    const id = 'missing-' + key
    const missing = verified(id)
    delete missing[key]
    refuse(report([line(id, 'baseline_missing', missing)], false))
    const inherited = Object.assign(Object.create({ [key]: 0 }), missing)
    assert.throws(() => buildOfflineSelectorReviewQueue(report([
      line(id, 'baseline_missing', inherited),
    ], false)), /^Error: Invalid offline capture comparison report$/)
  }
})

test('M5 inspection counts: negative/fractional/string/infinite and 129 records are rejected', () => {
  const id = 'bad-counts'
  for (const jsonLdCount of [-1, 1.5, NaN, Infinity, '1', null, 129, Number.MAX_SAFE_INTEGER + 1]) {
    refuse(report([line(id, 'baseline_missing', verified(id, { jsonLdCount }))], false))
  }
})

test('M5 inspection counts: parse errors cannot exceed record count or be malformed', () => {
  const id = 'invalid-parse-errors'
  for (const jsonLdParseErrors of [-1, 1.5, NaN, Infinity, '1', 1, 129, Number.MAX_SAFE_INTEGER + 1]) {
    refuse(report([line(id, 'baseline_missing', verified(id, { jsonLdCount: 0, jsonLdParseErrors }))], false))
  }
})

test('M5 inspection counts: exactly 128 records and 128 parse errors remain legal', () => {
  const id = 'upper-bound'
  const candidate = report([line(id, 'unchanged',
    verified(id, {jsonLdCount:128,jsonLdParseErrors:128}),
    verified(id, {jsonLdCount:128,jsonLdParseErrors:128}))])
  const previous = structuredClone(candidate)
  const output = buildOfflineSelectorReviewQueue(candidate)
  assert.equal(output.actions[0].priority, 'P3')
  assert.equal(output.productionReady, false)
  assert.equal(output.m5Eligible, false)
  assert.deepEqual(candidate, previous)
})

test('M5 inspection counts: unavailable cannot impersonate successful M1 signals', () => {
  const id = 'unavailable-signals'
  for (const key of ['hasNextData', 'jsonLdCount', 'jsonLdParseErrors']) {
    const current = failed(id)
    current[key] = key === 'hasNextData' ? false : 0
    refuse(report([line(id, 'unavailable', current)], false))
  }
  const normal = buildOfflineSelectorReviewQueue(report([line(id, 'unavailable', failed(id))], false))
  assert.equal(normal.actions[0].priority, 'P1')
})

test('M5 inspection counts: same verified HTML cannot carry contradictory next-data evidence', () => {
  const id = 'same-html-next'
  refuse(report([line(id, 'unchanged', verified(id, {hasNextData:true}), verified(id))]))
})

test('M5 inspection counts: same verified HTML cannot carry contradictory JSON-LD counts', () => {
  const id = 'same-html-count'
  refuse(report([line(id, 'unchanged',
    verified(id, {jsonLdCount:1}), verified(id))]))
})

test('M5 inspection counts: same verified HTML cannot carry contradictory parse errors', () => {
  const id = 'same-html-errors'
  refuse(report([line(id, 'unchanged',
    verified(id, {jsonLdCount:1,jsonLdParseErrors:1}),
    verified(id, {jsonLdCount:1,jsonLdParseErrors:0}))]))
})

test('M5 inspection counts: legitimate changed HTML and JSON-LD signals retains P1', () => {
  const id = 'changed-html'
  const output = buildOfflineSelectorReviewQueue(report([line(id, 'shape_changed',
    verified(id, {snapshotSha256:SHA_B,shapeSha256:SHAPE_B,jsonLdCount:1,jsonLdParseErrors:1}),
    verified(id))]))
  assert.equal(output.actions[0].priority, 'P1')
  assert.equal(output.rightsVerified, false)
  assert.equal(output.selectorVerified, false)
  assert.equal(output.actions[0].productionEnabled, false)
})

test('M5 inspection counts: changed HTML but stable shape remains P2', () => {
  const id = 'changed-content'
  const output = buildOfflineSelectorReviewQueue(report([line(id, 'content_changed_shape_stable',
    verified(id, {snapshotSha256:SHA_B}), verified(id))]))
  assert.equal(output.actions[0].priority, 'P2')
})

test('M5 inspection counts: valid 100+100 human review cohort remains bounded', () => {
  const historical = Array.from({length:100}, (_,i) => {
    const id = 'old-'+i
    return line(id, 'removed', null, verified(id))
  })
  const current = Array.from({length:100}, (_,i) => {
    const id = 'new-'+i
    return line(id, 'added', verified(id))
  })
  const q = buildOfflineSelectorReviewQueue(report([...historical,...current]))
  assert.equal(q.actions.length, 200)
  assert.equal(q.sourceCount, 100)
  assert.equal(q.m5Eligible, false)
})

test('M5 inspection counts: actual M1 parseError inspection round-trip is accepted', () => {
  const html = '<html><script type="application/ld+json">{bad json}</script></html>'
  const canonical = inspectHtml(html)
  const source = { id: 'canonical-html', supermarket: 'fictional-shop', kind:'product',
    success:true, integrity:'verified',
    manifestSha256:createHash('sha256').update(html).digest('hex'),
    schemaOrgProduct: { type:'abstain' }, html:canonical }
  const compared = compareInspections({sourceCount:1,sources:[source]},{sourceCount:1,sources:[structuredClone(source)]})
  assert.equal(compared.changes[0].current.jsonLdCount,1)
  assert.equal(compared.changes[0].current.jsonLdParseErrors,1)
  const review = buildOfflineSelectorReviewQueue(compared)
  assert.equal(review.actions[0].priority,'P3')
  assert.equal(review.m5Eligible,false)
})
