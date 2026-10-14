import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

const HTML_A = 'a'.repeat(64)
const HTML_B = 'b'.repeat(64)
const SHAPE_A = 'c'.repeat(64)
const SHAPE_B = 'd'.repeat(64)
const verified = (id, snapshotSha256 = HTML_A, shapeSha256 = SHAPE_A, schemaOrgStatus = 'abstain', supermarket = 'fictional-store') => ({
  id, supermarket, kind: 'product', captureStatus: 'verified',
  snapshotSha256, shapeSha256, schemaOrgStatus,
})
const unavailable = (id) => ({
  id, supermarket: 'fictional-store', kind: 'product',
  captureStatus: 'unavailable', snapshotSha256: null,
  shapeSha256: null, schemaOrgStatus: 'unknown',
})
const row = (id, status, current, baseline = null) => ({
  id, status, current, baseline,
})
const driftStatuses = new Set(['added', 'removed', 'unavailable', 'shape_changed', 'origin_changed'])
const report = (changes, baselineProvided = true) => ({
  contractVersion: 1,
  mode: 'offline_capture_signature_review_only',
  productionReady: false,
  m5Eligible: false,
  reviewerActionRequired: true,
  baselineProvided,
  captureCount: changes.filter((c) => c.current !== null).length,
  driftCount: changes.filter((c) => driftStatuses.has(c.status)).length,
  changes,
})
const rejectWithoutMutation = (candidate) => {
  const before = structuredClone(candidate)
  assert.throws(
    () => buildOfflineSelectorReviewQueue(candidate),
    /^Error: Invalid offline capture comparison report$/,
  )
  assert.deepEqual(candidate, before)
}

test('M5 same-HTML: forged P1 shape digest drift on exact same verified HTML is rejected', () => {
  const id = 'invented-source'
  rejectWithoutMutation(report([row(id, 'shape_changed',
    verified(id, HTML_A, SHAPE_B), verified(id, HTML_A, SHAPE_A))]))
})

test('M5 same-HTML: forged schema-org classification drift on same verified bytes is rejected', () => {
  const id = 'invented-schema'
  rejectWithoutMutation(report([row(id, 'shape_changed',
    verified(id, HTML_A, SHAPE_A, 'candidate_observation'),
    verified(id, HTML_A, SHAPE_A, 'abstain'))]))
})

test('M5 same-HTML: conflicting shape and schema simultaneously cannot claim P1', () => {
  const id = 'invented-double-drift'
  rejectWithoutMutation(report([row(id, 'shape_changed',
    verified(id, HTML_A, SHAPE_B, 'candidate_observation'),
    verified(id, HTML_A, SHAPE_A, 'abstain'))]))
})

test('M5 same-HTML: legitimate changed HTML and changed shape remains P1 review only', () => {
  const id = 'legitimate-shape'
  const input = report([row(id, 'shape_changed',
    verified(id, HTML_B, SHAPE_B), verified(id, HTML_A, SHAPE_A))])
  const before = structuredClone(input)
  const output = buildOfflineSelectorReviewQueue(input)
  assert.deepEqual(input, before)
  assert.equal(output.actions[0].priority, 'P1')
  assert.equal(output.actions[0].status, 'shape_changed')
  assert.equal(output.actions[0].selectorVerified, false)
  assert.equal(output.actions[0].rightsVerified, false)
  assert.equal(output.actions[0].productionEnabled, false)
})

test('M5 same-HTML: changed HTML with changed schema-org status remains P1', () => {
  const id = 'legitimate-schema'
  const output = buildOfflineSelectorReviewQueue(report([row(id, 'shape_changed',
    verified(id, HTML_B, SHAPE_A, 'candidate_observation'),
    verified(id, HTML_A, SHAPE_A, 'abstain'))]))
  assert.equal(output.actions[0].priority, 'P1')
  assert.equal(output.m5Eligible, false)
})

test('M5 same-HTML: exact verified HTML and shape is still P3 manual review', () => {
  const id = 'same-verified'
  const output = buildOfflineSelectorReviewQueue(report([row(id, 'unchanged',
    verified(id), verified(id))]))
  assert.equal(output.actions[0].priority, 'P3')
  assert.equal(output.actions[0].status, 'unchanged')
  assert.match(output.actions[0].sourceToken, /^[0-9a-f]{64}$/)
  assert.doesNotMatch(JSON.stringify(output), /same-verified|fictional-store/)
})

test('M5 same-HTML: changed HTML with identical shape remains P2, not false P1', () => {
  const id = 'stable-shape'
  const output = buildOfflineSelectorReviewQueue(report([row(id, 'content_changed_shape_stable',
    verified(id, HTML_B), verified(id, HTML_A))]))
  assert.equal(output.actions[0].priority, 'P2')
  assert.equal(output.actions[0].status, 'content_changed_shape_stable')
})

test('M5 same-HTML: same content in different store origins is still P1 provenance drift', () => {
  const id = 'origin-change'
  const output = buildOfflineSelectorReviewQueue(report([row(id, 'origin_changed',
    verified(id, HTML_A, SHAPE_A, 'abstain', 'fictional-new'),
    verified(id, HTML_A, SHAPE_A, 'abstain', 'fictional-old'))]))
  assert.equal(output.actions[0].priority, 'P1')
  assert.equal(output.actions[0].action, 'investigate_source_origin_change')
})

test('M5 same-HTML: unavailable current + verified historical remains P1 even without current SHA', () => {
  const id = 'capture-failed'
  const output = buildOfflineSelectorReviewQueue(report([row(id, 'unavailable',
    unavailable(id), verified(id))]))
  assert.equal(output.actions[0].priority, 'P1')
  assert.equal(output.rightsVerified, false)
})

test('M5 same-HTML: no-baseline first successful and failed controls stay P2 and P1', () => {
  const first = 'first-verified'
  const failed = 'first-failed'
  const output = buildOfflineSelectorReviewQueue(report([
    row(first, 'baseline_missing', verified(first)),
    row(failed, 'unavailable', unavailable(failed)),
  ], false))
  assert.deepEqual(output.actions.map((item) => item.priority), ['P1', 'P2'])
  assert.equal(output.baselineProvided, false)
  assert.equal(output.m5Eligible, false)
})

test('M5 same-HTML: max valid 100 current plus 100 historical independent sources retain 200 actions', () => {
  const old = Array.from({length: 100}, (_, index) => {
    const id = 'old-' + index
    return row(id, 'removed', null, verified(id))
  })
  const now = Array.from({length: 100}, (_, index) => {
    const id = 'new-' + index
    return row(id, 'added', verified(id))
  })
  const input = report([...old, ...now])
  const original = structuredClone(input)
  const output = buildOfflineSelectorReviewQueue(input)
  assert.equal(output.actions.length, 200)
  assert.equal(output.sourceCount, 100)
  assert.equal(output.driftCount, 200)
  assert.equal(output.productionReady, false)
  assert.equal(output.m5Eligible, false)
  assert.deepEqual(input, original)
})
