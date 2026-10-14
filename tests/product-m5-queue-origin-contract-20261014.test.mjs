import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

const HASH = 'a'.repeat(64)
const SHAPE = 'b'.repeat(64)
const snapshot = (id, origin = 'fictional-market', kind = 'product', state = 'verified') => ({
  id, supermarket: origin, kind, captureStatus: state,
  snapshotSha256: state === 'verified' ? HASH : null,
  shapeSha256: state === 'verified' ? SHAPE : null,
  schemaOrgStatus: state === 'verified' ? 'abstain' : 'unknown',
  ...(state === 'verified' ? { hasNextData: false, jsonLdCount: 0, jsonLdParseErrors: 0 } : {}),
})
const row = (id, status, current, baseline = null) => ({
  id, status, current, baseline,
})
const drifts = new Set(['removed', 'added', 'unavailable', 'shape_changed', 'origin_changed'])
const report = (rows, baselineProvided = true) => ({
  contractVersion: 1,
  mode: 'offline_capture_signature_review_only',
  productionReady: false,
  m5Eligible: false,
  reviewerActionRequired: true,
  baselineProvided,
  captureCount: rows.filter((item) => item.current !== null).length,
  driftCount: rows.filter((item) => drifts.has(item.status)).length,
  changes: rows,
})
const reject = (input) => {
  const pristine = structuredClone(input)
  assert.throws(() => buildOfflineSelectorReviewQueue(input),
    /^Error: Invalid offline capture comparison report$/)
  assert.deepEqual(input, pristine)
}

test('M5 queue origin: exactly 128-unit source ID remains accepted with opaque output', () => {
  const id = 's'.repeat(128)
  const result = buildOfflineSelectorReviewQueue(report([
    row(id, 'unchanged', snapshot(id), snapshot(id)),
  ]))
  assert.equal(result.actions[0].priority, 'P3')
  assert.match(result.actions[0].sourceToken, /^[a-f0-9]{64}$/)
  assert.doesNotMatch(JSON.stringify(result), /s{128}|fictional-market/)
  assert.equal(result.productionReady, false)
  assert.equal(result.m5Eligible, false)
})

test('M5 queue origin: 129-unit IDs cannot exceed canonical comparer ceiling', () => {
  const id = 'x'.repeat(129)
  reject(report([row(id, 'unchanged', snapshot(id), snapshot(id))]))
})

test('M5 queue origin: legitimate supplementary Unicode source token stays deterministic', () => {
  const id = 'local-🛒-source'
  const input = report([row(id, 'unchanged', snapshot(id), snapshot(id))])
  const before = structuredClone(input)
  const first = buildOfflineSelectorReviewQueue(input)
  const second = buildOfflineSelectorReviewQueue(input)
  assert.deepEqual(first, second)
  assert.deepEqual(input, before)
  assert.doesNotMatch(JSON.stringify(first), /🛒|local-/)
})

test('M5 queue origin: current snapshots with malformed retailer origins are refused', () => {
  for (const name of [
    undefined, null, '', ' ', {}, ['shop'], '\nshop', 'shop/name',
    'shop\\name', '\u202eSHOP', 'é-shop', 'x'.repeat(129),
  ]) {
    const id = 'private-current'
    const current = snapshot(id)
    current.supermarket = name
    reject(report([row(id, 'baseline_missing', current)], false))
  }
})

test('M5 queue origin: historical snapshots with malformed capture kinds are refused', () => {
  for (const kind of [
    undefined, null, '', ' ', 123, {}, ['product'], 'bad.kind/', '\u2066product',
    'x'.repeat(129),
  ]) {
    const id = 'private-history'
    const history = snapshot(id)
    history.kind = kind
    reject(report([row(id, 'removed', null, history)]))
  }
})

test('M5 queue origin: forged matching missing origins cannot acquire P3', () => {
  const id = 'private-same'
  const current = snapshot(id)
  const previous = snapshot(id)
  delete current.supermarket
  delete previous.supermarket
  reject(report([row(id, 'unchanged', current, previous)]))
})

test('M5 queue origin: failed first capture must still have canonical origin', () => {
  const id = 'unavailable'
  const bad = snapshot(id, {}, 'product', 'unavailable')
  reject(report([row(id, 'unavailable', bad)], false))
  const good = buildOfflineSelectorReviewQueue(report([
    row(id, 'unavailable', snapshot(id, 'fictional-market', 'product', 'unavailable')),
  ], false))
  assert.equal(good.actions[0].priority, 'P1')
  assert.equal(good.m5Eligible, false)
})

test('M5 queue origin: real canonical retailer drift is still high priority P1', () => {
  const id = 'canonical-drift'
  const result = buildOfflineSelectorReviewQueue(report([
    row(id, 'origin_changed', snapshot(id, 'fictional-market-b'), snapshot(id, 'fictional-market-a')),
  ]))
  assert.equal(result.actions[0].status, 'origin_changed')
  assert.equal(result.actions[0].priority, 'P1')
  assert.equal(result.actions[0].rightsVerified, false)
  assert.equal(result.actions[0].selectorVerified, false)
  assert.equal(result.actions[0].productionEnabled, false)
})

test('M5 queue origin: first verified source without historical baseline remains P2', () => {
  const id = 'new-fictitious'
  const result = buildOfflineSelectorReviewQueue(report([
    row(id, 'baseline_missing', snapshot(id)),
  ], false))
  assert.equal(result.actions[0].priority, 'P2')
  assert.equal(result.baselineProvided, false)
  assert.equal(result.productionReady, false)
})

test('M5 queue origin: valid 100 plus 100 physically distinct cohort still passes', () => {
  const old = Array.from({ length: 100 }, (_, n) => {
    const id = 'old-' + n
    return row(id, 'removed', null, snapshot(id))
  })
  const fresh = Array.from({ length: 100 }, (_, n) => {
    const id = 'new-' + n
    return row(id, 'added', snapshot(id))
  })
  const input = report([...old, ...fresh])
  const original = structuredClone(input)
  const result = buildOfflineSelectorReviewQueue(input)
  assert.equal(result.actions.length, 200)
  assert.equal(result.sourceCount, 100)
  assert.equal(result.driftCount, 200)
  assert.deepEqual(input, original)
  assert.equal(result.rightsVerified, false)
  assert.equal(result.m5Eligible, false)
})
