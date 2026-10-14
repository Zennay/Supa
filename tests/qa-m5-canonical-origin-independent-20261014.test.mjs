import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Synthetic pure-function QA only: no HTTP, supermarket observations, prices,
// users, or product-code modifications. Same file on original and fixed owner.
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const ok = (id, supermarket = 'fictional-store', kind = 'product') => ({
  id, supermarket, kind, captureStatus: 'verified',
  snapshotSha256: A, shapeSha256: B, schemaOrgStatus: 'abstain',
})
const failed = (id) => ({
  id, supermarket: 'fictional-store', kind: 'product',
  captureStatus: 'unavailable', snapshotSha256: null,
  shapeSha256: null, schemaOrgStatus: 'unknown',
})
const change = (id, status, current, baseline = null) => ({
  id, status, current, baseline,
})
const DRIFT = new Set(['unavailable', 'origin_changed', 'removed', 'shape_changed', 'added'])
const report = (changes, baselineProvided = true) => ({
  contractVersion: 1, mode: 'offline_capture_signature_review_only',
  productionReady: false, m5Eligible: false, reviewerActionRequired: true,
  baselineProvided,
  captureCount: changes.filter(x => x.current !== null).length,
  driftCount: changes.filter(x => DRIFT.has(x.status)).length,
  changes,
})
const reject = (input) =>
  assert.throws(() => buildOfflineSelectorReviewQueue(input),
    /^Error: Invalid offline capture comparison report$/)
const unchanged = (id, origin) =>
  change(id, 'unchanged', ok(id, origin), ok(id, origin))
const assertManualOnly = (out) => {
  assert.equal(out.productionReady, false)
  assert.equal(out.m5Eligible, false)
  assert.equal(out.selectorVerified, false)
  assert.equal(out.rightsVerified, false)
  assert.ok(out.actions.every(x =>
    x.productionEnabled === false && x.rightsVerified === false &&
    x.selectorVerified === false && /^[0-9a-f]{64}$/.test(x.sourceToken)))
}

test('QA M5 source origin: missing current and baseline supermarkets cannot make P3', () => {
  const x = unchanged('forged-unknown-store')
  delete x.current.supermarket
  delete x.baseline.supermarket
  reject(report([x]))
})

test('QA M5 source origin: missing capture kinds cannot make P3', () => {
  const x = unchanged('forged-unknown-kind')
  delete x.current.kind
  delete x.baseline.kind
  reject(report([x]))
})

test('QA M5 source origin: two equal null origin fields are invalid', () => {
  const x = unchanged('null-origin')
  x.current.supermarket = x.baseline.supermarket = null
  reject(report([x]))
})

test('QA M5 source origin: same object-valued store cannot masquerade as unchanged', () => {
  const x = unchanged('object-store')
  const forged = { id: 'fictional-store' }
  x.current.supermarket = x.baseline.supermarket = forged
  reject(report([x]))
})

test('QA M5 source origin: array-valued kind must be rejected', () => {
  const x = unchanged('array-kind')
  x.current.kind = x.baseline.kind = ['product']
  reject(report([x]))
})

test('QA M5 source origin: invisible newline and tab in origins are refused', () => {
  for (const origin of ['fictional\nstore', 'fictional\tstore']) {
    reject(report([unchanged('invisible-origin', origin)]))
  }
})

test('QA M5 source origin: padded supermarket identities are refused', () => {
  reject(report([unchanged('padded-store', ' fictional-store')]))
  reject(report([unchanged('padded-store', 'fictional-store ')]))
})

test('QA M5 source origin: punctuation prefix and slashes cannot identify a store', () => {
  reject(report([unchanged('slash-store', '/fictional')]))
  reject(report([unchanged('slash-store', '../fictional')]))
})

test('QA M5 source origin: 129-character supermarket exceeds upstream ceiling', () => {
  const input = report([unchanged('oversized-store', 'a'.repeat(129))])
  const before = structuredClone(input)
  reject(input)
  assert.deepEqual(input, before)
})

test('QA M5 source origin: 129-unit source identity exceeds canonical M1 source bound', () => {
  const id = 'x'.repeat(129)
  reject(report([change(id, 'baseline_missing', ok(id))], false))
})

test('QA M5 source origin: unavailable P1 cannot hide missing store metadata', () => {
  const id = 'unavailable-missing-store'
  const x = failed(id)
  delete x.supermarket
  reject(report([change(id, 'unavailable', x)], false))
})

test('QA M5 source origin: exactly 128 source-ID units remain private and valid', () => {
  const id = 'i'.repeat(128)
  const out = buildOfflineSelectorReviewQueue(report([
    change(id, 'baseline_missing', ok(id)),
  ], false))
  assert.deepEqual(out.actions.map(x => [x.priority, x.status]),
    [['P2', 'baseline_missing']])
  assert.doesNotMatch(JSON.stringify(out), new RegExp(id))
  assertManualOnly(out)
})

test('QA M5 source origin: exactly 128 canonical store characters are valid', () => {
  const id = 'boundary-store'
  const origin = 'Z' + 'a'.repeat(127)
  const out = buildOfflineSelectorReviewQueue(report([unchanged(id, origin)]))
  assert.equal(out.actions[0].priority, 'P3')
  assertManualOnly(out)
})

test('QA M5 source origin: valid Unicode source IDs still receive opaque tokens', () => {
  const id = 'fictief-🛒-winkel-' + 'é'
  const out = buildOfflineSelectorReviewQueue(report([
    change(id, 'baseline_missing', ok(id)),
  ], false))
  assert.equal(out.actions[0].priority, 'P2')
  assert.doesNotMatch(JSON.stringify(out), /fictief|winkel/)
  assertManualOnly(out)
})

test('QA M5 source origin: genuine supermarket-origin drift is P1', () => {
  const id = 'real-provenance-drift-fictitious'
  const out = buildOfflineSelectorReviewQueue(report([
    change(id, 'origin_changed', ok(id, 'other-fictional-store'), ok(id)),
  ]))
  assert.equal(out.actions[0].priority, 'P1')
  assert.equal(out.actions[0].status, 'origin_changed')
  assertManualOnly(out)
})

test('QA M5 source origin: canonical unchanged P3 retains manual-only status', () => {
  const id = 'canonical-stable'
  const x = unchanged(id)
  const before = structuredClone(x)
  const out = buildOfflineSelectorReviewQueue(report([x]))
  assert.equal(out.actions[0].priority, 'P3')
  assert.deepEqual(x, before)
  assertManualOnly(out)
})

test('QA M5 source origin: disjoint physically valid 100+100 captures still produce 200 actions', () => {
  const current = Array.from({ length: 100 }, (_, i) => {
    const id = 'current-' + i
    return change(id, 'added', ok(id))
  })
  const previous = Array.from({ length: 100 }, (_, i) => {
    const id = 'history-' + i
    return change(id, 'removed', null, ok(id))
  })
  const input = report([...current, ...previous])
  const prior = structuredClone(input)
  const out = buildOfflineSelectorReviewQueue(input)
  assert.equal(out.actions.length, 200)
  assert.equal(out.sourceCount, 100)
  assert.equal(out.driftCount, 200)
  assert.equal(out.actions.filter(x => x.priority === 'P1').length, 100)
  assert.equal(out.actions.filter(x => x.priority === 'P2').length, 100)
  assertManualOnly(out)
  assert.deepEqual(input, prior)
})
