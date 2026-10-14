import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const verified = (id, origin = 'fictional-market') => ({
  id, supermarket: origin, kind: 'product',
  captureStatus: 'verified', snapshotSha256: A, shapeSha256: B,
  schemaOrgStatus: 'abstain',
  hasNextData: false, jsonLdCount: 0, jsonLdParseErrors: 0,
})
const unavailable = (id) => ({
  id, supermarket: 'fictional-market', kind: 'product',
  captureStatus: 'unavailable', snapshotSha256: null,
  shapeSha256: null, schemaOrgStatus: 'unknown',
})
const entry = (id, status, current, baseline = null) => ({
  id, status, current, baseline,
})
const DRIFT = new Set(['unavailable', 'origin_changed', 'removed', 'shape_changed', 'added'])
const report = (changes, baselineProvided = false) => ({
  contractVersion: 1,
  mode: 'offline_capture_signature_review_only',
  productionReady: false,
  m5Eligible: false,
  reviewerActionRequired: true,
  baselineProvided,
  captureCount: changes.filter((change) => change?.current !== null && change !== undefined).length,
  driftCount: changes.filter((change) => change && DRIFT.has(change.status)).length,
  changes,
})
function fail(candidate) {
  assert.throws(() => buildOfflineSelectorReviewQueue(candidate),
    /^Error: Invalid offline capture comparison report$/)
}

test('product dense queue: entirely missing slots cannot become null review actions', () => {
  const holes = new Array(3)
  fail({ ...report([], false), changes: holes })
  assert.equal(holes.length, 3)
  assert.equal(Object.hasOwn(holes, 0), false)
})

test('product dense queue: missing slot ahead of valid P2 row is rejected', () => {
  const changes = new Array(2)
  changes[1] = entry('later', 'baseline_missing', verified('later'))
  fail(report(changes))
  assert.equal(Object.hasOwn(changes, 0), false)
  assert.equal(changes[1].id, 'later')
})

test('product dense queue: gap between valid P1 and P2 cannot silently disappear', () => {
  const changes = [
    entry('failure', 'unavailable', unavailable('failure')),
    ,
    entry('new', 'baseline_missing', verified('new')),
  ]
  fail(report(changes))
  assert.equal(changes.length, 3)
})

test('product dense queue: 200-slot sparse boundary is not accepted', () => {
  const changes = new Array(200)
  changes[0] = entry('failure', 'unavailable', unavailable('failure'))
  changes[199] = entry('new', 'baseline_missing', verified('new'))
  fail(report(changes))
  assert.equal(changes.length, 200)
})

test('product dense queue: array masquerading as a change object is refused', () => {
  const fake = []
  Object.assign(fake, entry('masked', 'baseline_missing', verified('masked')))
  fail(report([fake]))
  assert.equal(fake.status, 'baseline_missing')
})

test('product dense queue: array masquerading as a verified current snapshot is refused', () => {
  const fake = []
  Object.assign(fake, verified('masked'))
  fail(report([entry('masked', 'baseline_missing', fake)]))
  assert.equal(fake.id, 'masked')
})

test('product dense queue: array masquerading as an unavailable P1 snapshot is refused', () => {
  const fake = []
  Object.assign(fake, unavailable('unavailable'))
  fail(report([entry('unavailable', 'unavailable', fake)]))
})

test('product dense queue: array masquerading as a historical snapshot is refused', () => {
  const fakeOld = []
  Object.assign(fakeOld, verified('same'))
  fail(report([entry('same', 'unchanged', verified('same'), fakeOld)], true))
})

test('product dense queue: dense valid P1+P2 passes with private hashed identifiers', () => {
  const changes = [
    entry('new', 'baseline_missing', verified('new')),
    entry('failure', 'unavailable', unavailable('failure')),
  ]
  const original = structuredClone(changes)
  const value = buildOfflineSelectorReviewQueue(report(changes))
  assert.deepEqual(changes, original)
  assert.deepEqual(value.actions.map((a) => a.priority), ['P1', 'P2'])
  assert.equal(value.actions.length, 2)
  assert.ok(value.actions.every((a) => /^[a-f0-9]{64}$/.test(a.sourceToken)))
  assert.equal(value.productionReady, false)
  assert.equal(value.m5Eligible, false)
  assert.equal(value.rightsVerified, false)
})

test('product dense queue: historical unchanged P3 is still admitted for real dense input', () => {
  const state = verified('same')
  const value = buildOfflineSelectorReviewQueue(report([
    entry('same', 'unchanged', state, { ...state }),
  ], true))
  assert.deepEqual(value.actions.map((a) => [a.priority, a.status]), [['P3', 'unchanged']])
  assert.equal(value.baselineProvided, true)
  assert.equal(value.m5Eligible, false)
})

test('product dense queue: valid origin shift remains P1, never P3', () => {
  const value = buildOfflineSelectorReviewQueue(report([
    entry('same', 'origin_changed', verified('same', 'other-store'), verified('same')),
  ], true))
  assert.equal(value.actions[0].priority, 'P1')
  assert.equal(value.actions[0].status, 'origin_changed')
  assert.equal(value.driftCount, 1)
})

test('product dense queue: fully dense 200-row union of exactly 100+100 captures stays valid', () => {
  const removed = Array.from({ length: 100 }, (_, index) => {
    const id = 'removed-' + index
    return entry(id, 'removed', null, verified(id))
  })
  const added = Array.from({ length: 100 }, (_, index) => {
    const id = 'added-' + index
    return entry(id, 'added', verified(id))
  })
  const changes = [...removed, ...added]
  const value = buildOfflineSelectorReviewQueue(report(changes, true))
  assert.equal(value.actions.length, 200)
  assert.equal(value.sourceCount, 100)
  assert.equal(value.driftCount, 200)
  assert.equal(value.productionReady, false)
  assert.equal(value.m5Eligible, false)
  assert.deepEqual(value.actions.map((action) => action.priority),
    [...Array(100).fill('P1'), ...Array(100).fill('P2')])
})

test('product dense queue: more than 200 dense records still fail closed', () => {
  const changes = Array.from({ length: 201 }, (_, i) => {
    const id = 'removed-' + i
    return entry(id, 'removed', null, verified(id))
  })
  fail(report(changes, true))
})

test('product dense queue: deterministic source tokens and action ordering survive dense input permutation', () => {
  const changes = [
    entry('failing', 'unavailable', unavailable('failing')),
    entry('new', 'added', verified('new')),
    entry('historical', 'removed', null, verified('historical')),
  ]
  const a = buildOfflineSelectorReviewQueue(report(changes, true))
  const b = buildOfflineSelectorReviewQueue(report([...changes].reverse(), true))
  assert.deepEqual(a, b)
  assert.deepEqual(a.actions.map((x) => x.priority), ['P1', 'P1', 'P2'])
})
