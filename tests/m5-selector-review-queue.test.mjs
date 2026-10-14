import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

const H = 'a'.repeat(64)
const B = 'b'.repeat(64)
const verified = (id, sha = H, shape = B) => ({ id, supermarket: 'fictional-market', kind: 'product', captureStatus: 'verified', snapshotSha256: sha, shapeSha256: shape, schemaOrgStatus: 'abstain' })
const absent = (id) => ({ id, supermarket: 'fictional-market', kind: 'product', captureStatus: 'unavailable', snapshotSha256: null, shapeSha256: null, schemaOrgStatus: 'unknown' })
const change = (id, status, current, baseline) => ({ id, status, current, baseline })
const comparison = (changes, baselineProvided = true) => ({
  contractVersion: 1,
  mode: 'offline_capture_signature_review_only',
  baselineProvided,
  productionReady: false,
  m5Eligible: false,
  reviewerActionRequired: true,
  captureCount: changes.filter((c) => c.current !== null).length,
  driftCount: changes.filter((c) => ['added', 'removed', 'unavailable', 'shape_changed'].includes(c.status)).length,
  changes,
})

test('six comparable offline statuses generate deterministic review work without claiming verified selectors', () => {
  const changes = [
    change('unchanged', 'unchanged', verified('unchanged'), verified('unchanged')),
    change('added', 'added', verified('added'), null),
    change('removed', 'removed', null, verified('removed')),
    change('missing', 'unavailable', absent('missing'), verified('missing')),
    change('shape', 'shape_changed', verified('shape', H, H), verified('shape')),
    change('content', 'content_changed_shape_stable', verified('content', B), verified('content')),
  ]
  const before = comparison(changes)
  const first = buildOfflineSelectorReviewQueue(before)
  const second = buildOfflineSelectorReviewQueue(comparison([...changes].reverse()))
  assert.deepEqual(first, second)
  assert.equal(first.driftCount, 4)
  assert.equal(first.sourceCount, 5)
  assert.deepEqual(first.actions.map((x) => x.priority), ['P1', 'P1', 'P1', 'P2', 'P2', 'P3'])
  assert.equal(first.m5Eligible, false)
  assert.equal(first.productionReady, false)
  assert.equal(first.rightsVerified, false)
  assert.equal(first.selectorVerified, false)
  assert.equal(first.actions.every((x) => !x.selectorVerified && !x.rightsVerified && !x.productionEnabled), true)
  assert.deepEqual(before.changes, changes)
})

test('new capture without a baseline cannot be interpreted as unchanged', () => {
  const x = buildOfflineSelectorReviewQueue(comparison([
    change('first', 'baseline_missing', verified('first'), null),
  ], false))
  assert.equal(x.actions[0].action, 'establish_approved_baseline')
  assert.equal(x.baselineProvided, false)
  assert.throws(() => buildOfflineSelectorReviewQueue(comparison([
    change('first', 'unchanged', verified('first'), verified('first')),
  ], false)), /Invalid offline/)
})

test('fails closed on impossible status, report flags, missing capture and forged drift count', () => {
  const valid = comparison([change('one', 'shape_changed', verified('one'), verified('one', H, H))])
  const bad = [
    { ...valid, productionReady: true },
    { ...valid, m5Eligible: true },
    { ...valid, reviewerActionRequired: false },
    { ...valid, contractVersion: 2 },
    { ...valid, captureCount: 2 },
    { ...valid, driftCount: 0 },
    { ...valid, changes: [change('one', 'unknown', verified('one'), verified('one'))] },
    { ...valid, changes: [change('one', 'removed', verified('one'), verified('one'))] },
    { ...valid, changes: [change('one', 'shape_changed', absent('one'), verified('one'))] },
    { ...valid, changes: [change('one', 'shape_changed', verified('one', 'bad'), verified('one'))] },
    { ...valid, changes: [valid.changes[0], valid.changes[0]] },
    comparison([change('one', 'unchanged', verified('one', H), verified('one', B))]),
    comparison([change('one', 'content_changed_shape_stable', verified('one'), verified('one'))]),
    comparison([change('one', 'shape_changed', verified('one'), verified('one'))]),
  ]
  for (const report of bad) assert.throws(() => buildOfflineSelectorReviewQueue(report), /Invalid offline/)
})

test('opaque source tokens do not echo synthetic sensitive labels and do not collide between input identifiers', () => {
  const secret = 'person.fictional@example.invalid'
  const report = comparison([
    change(secret, 'added', verified(secret), null),
    change('different', 'added', verified('different'), null),
  ])
  const output = buildOfflineSelectorReviewQueue(report)
  assert.doesNotMatch(JSON.stringify(output), /person|fictional|example|@/)
  assert.notEqual(output.actions[0].sourceToken, output.actions[1].sourceToken)
  assert.match(output.actions[0].sourceToken, /^[a-f0-9]{64}$/)
})

test('rejects oversized and nonsensical containers without iterating into input details', () => {
  const invalid = comparison([])
  for (const report of [null, [], { ...invalid, changes: Array(201).fill(null) },
    { ...invalid, captureCount: Number.MAX_SAFE_INTEGER },
    { ...invalid, changes: [change('none', 'added', null, null)] },
  ]) assert.throws(() => buildOfflineSelectorReviewQueue(report), /Invalid offline/)
})
