import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independent synthetic QA only; no real store capture, source rights or M5
// operating permission is implied by these in-memory comparison fixtures.
const H = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)

const verified = (id, sha = H, shape = B, schemaOrgStatus = 'abstain') =>
  ({ id, supermarket: 'fictional-market', kind: 'product', captureStatus: 'verified', snapshotSha256: sha, shapeSha256: shape, schemaOrgStatus, hasNextData: false, jsonLdCount: schemaOrgStatus === 'candidate_observation' ? 1 : 0, jsonLdParseErrors: 0 })
const unavailable = (id) =>
  ({ id, supermarket: 'fictional-market', kind: 'product', captureStatus: 'unavailable', snapshotSha256: null, shapeSha256: null, schemaOrgStatus: 'unknown' })
const change = (id, status, current, baseline) => ({ id, status, current, baseline })
const DRIFT = new Set(['added', 'removed', 'unavailable', 'shape_changed'])

function report(changes) {
  return {
    contractVersion: 1,
    mode: 'offline_capture_signature_review_only',
    baselineProvided: true,
    productionReady: false,
    m5Eligible: false,
    reviewerActionRequired: true,
    captureCount: changes.filter((x) => x.current !== null).length,
    driftCount: changes.filter((x) => DRIFT.has(x.status)).length,
    changes,
  }
}

test('M5 QA positive: distinct ordinary source IDs yield stable non-colliding opaque tokens', () => {
  const source = report([
    change('store-a', 'added', verified('store-a'), null),
    change('store-b', 'added', verified('store-b'), null),
  ])
  const before = JSON.stringify(source)
  const result = buildOfflineSelectorReviewQueue(source)
  assert.equal(result.actions.length, 2)
  assert.notEqual(result.actions[0].sourceToken, result.actions[1].sourceToken)
  assert.equal(result.actions.every((action) =>
    /^[a-f0-9]{64}$/.test(action.sourceToken) &&
    action.selectorVerified === false &&
    action.rightsVerified === false &&
    action.productionEnabled === false), true)
  assert.equal(result.productionReady, false)
  assert.equal(result.m5Eligible, false)
  assert.equal(JSON.stringify(source), before)
  assert.deepEqual(buildOfflineSelectorReviewQueue(report([...source.changes].reverse())), result)
})

test('M5 QA positive: canonical unavailable capture with null hashes remains P1 human-only', () => {
  const source = report([
    change('offline-one', 'unavailable', unavailable('offline-one'), verified('offline-one')),
  ])
  const result = buildOfflineSelectorReviewQueue(source)
  assert.equal(result.driftCount, 1)
  assert.deepEqual(result.actions.map((action) => [action.priority, action.action]),
    [['P1', 'recapture_or_investigate_failure']])
  assert.equal(result.reviewerActionRequired, true)
  assert.equal(result.productionReady, false)
  assert.equal(result.selectorVerified, false)
})

test('M5 QA positive: canonical schema-org state changes are P1 review, not selector approval', () => {
  const source = report([change('offline-two', 'shape_changed',
    verified('offline-two', C, B, 'candidate_observation'),
    verified('offline-two', H, B, 'abstain'))])
  const result = buildOfflineSelectorReviewQueue(source)
  assert.equal(result.actions[0].priority, 'P1')
  assert.equal(result.actions[0].selectorVerified, false)
  assert.equal(result.rightsVerified, false)
})

test('M5 QA RED: two different isolated-surrogate source identities cannot share one review token', () => {
  // JavaScript treats these as two distinct strings; UTF-8 encoding silently
  // replaces each unpaired surrogate with U+FFFD, yielding identical SHA input.
  // Canonical policy should reject invalid Unicode before tokenisation.
  const left = 'source-\uD800'
  const right = 'source-\uDC00'
  assert.notEqual(left, right)
  const source = report([
    change(left, 'added', verified(left), null),
    change(right, 'added', verified(right), null),
  ])
  const before = JSON.stringify(source)
  assert.throws(() => buildOfflineSelectorReviewQueue(source),
    /Invalid offline capture comparison report/)
  assert.equal(JSON.stringify(source), before)
})

test('M5 QA RED: forged verified schemaOrgStatus cannot masquerade as unchanged capture', () => {
  // Canonical captureShape() never produces this status; preserving it in
  // both snapshots cannot make its provenance valid.
  const fake = verified('offline-three', H, B, 'production_verified')
  const source = report([change('offline-three', 'unchanged', fake, { ...fake })])
  assert.throws(() => buildOfflineSelectorReviewQueue(source),
    /Invalid offline capture comparison report/)
})

test('M5 QA RED: unavailable capture may not carry a supposedly verified digest', () => {
  const forged = { ...unavailable('offline-four'), snapshotSha256: H }
  const source = report([change('offline-four', 'unavailable',
    forged, verified('offline-four'))])
  assert.throws(() => buildOfflineSelectorReviewQueue(source),
    /Invalid offline capture comparison report/)
})

test('M5 QA RED: unavailable capture may not claim a verified schema-org observation', () => {
  const forged = { ...unavailable('offline-five'), schemaOrgStatus: 'candidate_observation' }
  const source = report([change('offline-five', 'unavailable',
    forged, verified('offline-five'))])
  assert.throws(() => buildOfflineSelectorReviewQueue(source),
    /Invalid offline capture comparison report/)
})
