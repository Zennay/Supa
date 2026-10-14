import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independent, entirely synthetic offline M5 QA. No network requests, prices,
// users, retailer access or changes to the product-owned implementation.
const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const verified = (id) => ({
  id, supermarket: 'fictional-store', kind: 'product',
  captureStatus: 'verified', snapshotSha256: SHA_A, shapeSha256: SHA_B,
  schemaOrgStatus: 'abstain',
  hasNextData: false, jsonLdCount: 0, jsonLdParseErrors: 0,
})
const unavailable = (id) => ({
  id, supermarket: 'fictional-store', kind: 'product',
  captureStatus: 'unavailable', snapshotSha256: null, shapeSha256: null,
  schemaOrgStatus: 'unknown',
})
const row = (id, status, current = null, baseline = null) => ({
  id, status, current, baseline,
})
const removed = (count, prefix = 'historical-') =>
  Array.from({ length: count }, (_, index) => {
    const id = prefix + index
    return row(id, 'removed', null, verified(id))
  })
const added = (count, prefix = 'present-') =>
  Array.from({ length: count }, (_, index) => {
    const id = prefix + index
    return row(id, 'added', verified(id))
  })
const DRIFT = new Set(['unavailable', 'origin_changed', 'removed', 'shape_changed', 'added'])
const report = (changes, baselineProvided = true) => ({
  contractVersion: 1, mode: 'offline_capture_signature_review_only',
  productionReady: false, m5Eligible: false, reviewerActionRequired: true,
  baselineProvided,
  captureCount: changes.filter((change) => change.current !== null).length,
  driftCount: changes.filter((change) => DRIFT.has(change.status)).length,
  changes,
})
const refuse = (input) =>
  assert.throws(() => buildOfflineSelectorReviewQueue(input),
    /^Error: Invalid offline capture comparison report$/)
const checkPrivateHold = (out) => {
  assert.equal(out.productionReady, false)
  assert.equal(out.m5Eligible, false)
  assert.equal(out.rightsVerified, false)
  assert.equal(out.selectorVerified, false)
  assert.ok(out.actions.every((action) =>
    action.productionEnabled === false &&
    action.rightsVerified === false && action.selectorVerified === false &&
    /^[a-f0-9]{64}$/.test(action.sourceToken)))
}

test('QA historical contract: 101 removed snapshots must never be admitted', () => {
  const input = report(removed(101))
  const before = structuredClone(input)
  refuse(input)
  assert.deepEqual(input, before)
})

test('QA historical contract: 200 removed snapshots cannot bypass captureCount=0', () => {
  const input = report(removed(200))
  assert.equal(input.captureCount, 0)
  assert.equal(input.changes.length, 200)
  refuse(input)
})

test('QA historical contract: valid 100 baseline-only sources remain conservative', () => {
  const input = report(removed(100))
  const before = structuredClone(input)
  const out = buildOfflineSelectorReviewQueue(input)
  assert.equal(out.sourceCount, 0)
  assert.equal(out.driftCount, 100)
  assert.equal(out.actions.length, 100)
  assert.ok(out.actions.every((action) => action.status === 'removed' && action.priority === 'P1'))
  checkPrivateHold(out)
  assert.deepEqual(input, before)
})

test('QA historical contract: disjoint current-100 plus historical-100 union is valid', () => {
  const input = report([...added(100), ...removed(100)])
  const out = buildOfflineSelectorReviewQueue(input)
  assert.equal(out.sourceCount, 100)
  assert.equal(out.driftCount, 200)
  assert.equal(out.actions.length, 200)
  assert.equal(out.actions.filter((x) => x.priority === 'P1').length, 100)
  assert.equal(out.actions.filter((x) => x.priority === 'P2').length, 100)
  checkPrivateHold(out)
})

test('QA historical contract: 101 baseline records still fail when current uses all 100 slots', () => {
  const input = report([...added(100), ...removed(101)])
  assert.equal(input.changes.length, 201)
  // Ensure the rejected case stays within the normal 200-row action envelope:
  const withOverlap = [...removed(101), ...added(99)]
  assert.equal(withOverlap.length, 200)
  assert.equal(report(withOverlap).captureCount, 99)
  refuse(report(withOverlap))
  refuse(input)
})

test('QA historical contract: absent-baseline unavailable cannot hide verified history', () => {
  const id = 'private-provenance-sentinel-v'
  const input = report([row(id, 'unavailable', unavailable(id), verified(id))], false)
  const original = JSON.stringify(input)
  refuse(input)
  assert.equal(JSON.stringify(input), original)
})

test('QA historical contract: absent-baseline unavailable cannot hide unavailable history', () => {
  const id = 'private-provenance-sentinel-u'
  refuse(report([row(id, 'unavailable', unavailable(id), unavailable(id))], false))
})

test('QA historical contract: empty declared baseline denies any historical P1 record', () => {
  const id = 'hidden-history'
  const source = report([row(id, 'unavailable', unavailable(id), verified(id))], true)
  assert.equal(buildOfflineSelectorReviewQueue(source).actions[0].priority, 'P1')
  const switched = { ...source, baselineProvided: false }
  refuse(switched)
  assert.equal(source.baselineProvided, true)
})

test('QA historical contract: true no-baseline unavailable P1 remains review-only', () => {
  const id = 'new-offline-failure'
  const out = buildOfflineSelectorReviewQueue(report([
    row(id, 'unavailable', unavailable(id)),
  ], false))
  assert.deepEqual(out.actions.map((a) => [a.status, a.priority]),
    [['unavailable', 'P1']])
  checkPrivateHold(out)
})

test('QA historical contract: true no-baseline verified P2 remains review-only', () => {
  const id = 'new-offline-capture'
  const out = buildOfflineSelectorReviewQueue(report([
    row(id, 'baseline_missing', verified(id)),
  ], false))
  assert.deepEqual(out.actions.map((a) => [a.status, a.priority]),
    [['baseline_missing', 'P2']])
  checkPrivateHold(out)
})

test('QA historical contract: historical unavailable current failure is legitimate P1', () => {
  const id = 'later-observation-failed'
  const out = buildOfflineSelectorReviewQueue(report([
    row(id, 'unavailable', unavailable(id), verified(id)),
  ], true))
  assert.deepEqual(out.actions.map((a) => [a.status, a.priority]),
    [['unavailable', 'P1']])
  checkPrivateHold(out)
})

test('QA historical contract: unchanged current/historical P3 remains valid', () => {
  const id = 'stable-offline-source'
  const snapshot = verified(id)
  const out = buildOfflineSelectorReviewQueue(report([
    row(id, 'unchanged', snapshot, { ...snapshot }),
  ]))
  assert.deepEqual(out.actions.map((a) => [a.status, a.priority]), [['unchanged', 'P3']])
  checkPrivateHold(out)
})

test('QA historical contract: no-baseline 100 unavailable P1 sources remain allowed', () => {
  const entries = Array.from({ length: 100 }, (_, i) => {
    const id = 'offline-unavailable-' + i
    return row(id, 'unavailable', unavailable(id))
  })
  const out = buildOfflineSelectorReviewQueue(report(entries, false))
  assert.equal(out.sourceCount, 100)
  assert.equal(out.actions.length, 100)
  checkPrivateHold(out)
})

test('QA historical contract: deterministic private ordering with 100+100 sources', () => {
  const changes = [...added(100), ...removed(100)]
  const one = buildOfflineSelectorReviewQueue(report(changes))
  const two = buildOfflineSelectorReviewQueue(report([...changes].reverse()))
  assert.deepEqual(one, two)
  assert.doesNotMatch(JSON.stringify(one), /historical-|present-|fictional-store/)
  checkPrivateHold(one)
})

test('QA historical contract: empty report remains manual-only and immutable', () => {
  const input = report([], false)
  const original = structuredClone(input)
  const out = buildOfflineSelectorReviewQueue(input)
  assert.deepEqual(out.actions, [])
  assert.equal(out.sourceCount, 0)
  assert.equal(out.driftCount, 0)
  checkPrivateHold(out)
  assert.deepEqual(input, original)
})
