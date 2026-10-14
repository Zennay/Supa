import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'

// Entirely fictional, local-only. Never use retailer or participant data.
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const verified = (id, html = A, shape = B) => ({
  id, supermarket: 'fictional', kind: 'product', captureStatus: 'verified',
  snapshotSha256: html, shapeSha256: shape, schemaOrgStatus: 'abstain',
  hasNextData: false, jsonLdCount: 0, jsonLdParseErrors: 0,
})
const unavailable = id => ({
  id, supermarket: 'fictional', kind: 'product', captureStatus: 'unavailable',
  snapshotSha256: null, shapeSha256: null, schemaOrgStatus: 'unknown',
})
const row = (id, status, current, baseline = null) => ({
  id, status, current, baseline,
})
const DRIFT = new Set(['unavailable', 'origin_changed', 'removed', 'shape_changed', 'added'])
const report = (changes, baselineProvided = true) => ({
  contractVersion: 1, mode: 'offline_capture_signature_review_only',
  productionReady: false, m5Eligible: false, reviewerActionRequired: true,
  baselineProvided, captureCount: changes.filter(x => x.current !== null).length,
  driftCount: changes.filter(x => DRIFT.has(x.status)).length, changes,
})
const reject = input => assert.throws(() => buildOfflineSelectorReviewQueue(input),
  /^Error: Invalid offline capture comparison report$/)
const unchanged = id => row(id, 'unchanged', verified(id), verified(id))
const assertHold = result => {
  for (const k of ['rightsVerified', 'selectorVerified', 'productionReady', 'm5Eligible']) {
    assert.equal(result[k], false)
  }
  assert.ok(result.actions.every(x => !x.productionEnabled &&
    !x.rightsVerified && !x.selectorVerified &&
    /^[a-f0-9]{64}$/.test(x.sourceToken)))
}

test('independent M5 inspected signals: missing hasNextData never qualifies verified P3', () => {
  const x = unchanged('missing-flag')
  delete x.current.hasNextData
  delete x.baseline.hasNextData
  reject(report([x]))
})
test('independent M5 inspected signals: string and numeric flags cannot be boolean', () => {
  for (const candidate of ['false', 'true', 0, 1, null]) {
    const x = unchanged('forged-flag')
    x.current.hasNextData = x.baseline.hasNextData = candidate
    reject(report([x]))
  }
})
test('independent M5 inspected signals: missing count cannot be trusted', () => {
  const x = unchanged('missing-count')
  delete x.current.jsonLdCount
  delete x.baseline.jsonLdCount
  reject(report([x]))
})
test('independent M5 inspected signals: fractional, negative, string and oversized JSON-LD count refused', () => {
  for (const candidate of [-1, 1.5, '2', null, 129, Number.MAX_SAFE_INTEGER + 1]) {
    const x = unchanged('fake-ld-count')
    x.current.jsonLdCount = x.baseline.jsonLdCount = candidate
    reject(report([x]))
  }
})
test('independent M5 inspected signals: missing parse-error count cannot be trusted', () => {
  const x = unchanged('missing-parse-count')
  delete x.current.jsonLdParseErrors
  delete x.baseline.jsonLdParseErrors
  reject(report([x]))
})
test('independent M5 inspected signals: negative/fractional/non-integer parse errors fail closed', () => {
  for (const candidate of [-1, 0.5, '0', null, 129]) {
    const x = unchanged('fake-error-count')
    x.current.jsonLdParseErrors = x.baseline.jsonLdParseErrors = candidate
    reject(report([x]))
  }
})
test('independent M5 inspected signals: errors cannot exceed inspected JSON-LD entries', () => {
  const x = unchanged('impossible-majority')
  x.current.jsonLdCount = x.baseline.jsonLdCount = 1
  x.current.jsonLdParseErrors = x.baseline.jsonLdParseErrors = 2
  reject(report([x]))
})
test('independent M5 inspected signals: unavailable P1 cannot possess hasNextData', () => {
  const id = 'failed-with-fake-html-flag'
  const x = unavailable(id)
  x.hasNextData = false
  reject(report([row(id, 'unavailable', x)], false))
})
test('independent M5 inspected signals: unavailable P1 cannot possess parser counts', () => {
  for (const key of ['jsonLdCount', 'jsonLdParseErrors']) {
    const id = 'failed-with-' + key
    const x = unavailable(id)
    x[key] = 0
    reject(report([row(id, 'unavailable', x)], false))
  }
})
test('independent M5 inspected signals: identical HTML cannot change next-data flag', () => {
  const x = unchanged('same-html-new-flag')
  x.current.hasNextData = true
  const frozen = structuredClone(x)
  reject(report([x]))
  assert.deepEqual(x, frozen)
})
test('independent M5 inspected signals: identical HTML cannot change JSON-LD count', () => {
  const x = unchanged('same-html-count')
  x.current.jsonLdCount = 1
  reject(report([x]))
})
test('independent M5 inspected signals: identical HTML cannot change parse-error count', () => {
  const x = unchanged('same-html-error-count')
  x.current.jsonLdCount = x.baseline.jsonLdCount = 1
  x.current.jsonLdParseErrors = 1
  reject(report([x]))
})
test('independent M5 inspected signals: inherited fields cannot replace own canonical metadata', () => {
  const x = unchanged('prototype-count')
  const inherited = Object.create({ jsonLdCount: 0 })
  Object.assign(inherited, x.current)
  delete inherited.jsonLdCount
  x.current = inherited
  reject(report([x]))
})
test('independent M5 inspected signals: genuine canonical P3 stays private and manual', () => {
  const x = unchanged('stable')
  const before = structuredClone(x)
  const out = buildOfflineSelectorReviewQueue(report([x]))
  assert.deepEqual(out.actions.map(a => [a.priority, a.status]), [['P3', 'unchanged']])
  assert.deepEqual(x, before)
  assertHold(out)
})
test('independent M5 inspected signals: 128 entries and 128 parse errors are valid', () => {
  const id = 'bounded-maximum'
  const a = verified(id)
  a.jsonLdCount = a.jsonLdParseErrors = 128
  const out = buildOfflineSelectorReviewQueue(report([
    row(id, 'unchanged', a, { ...a }),
  ]))
  assert.equal(out.actions[0].priority, 'P3')
  assertHold(out)
})
test('independent M5 inspected signals: true changed HTML with changed structure remains P1', () => {
  const id = 'legitimate-drift'
  const a = verified(id, B, C)
  a.jsonLdCount = 1
  const out = buildOfflineSelectorReviewQueue(report([
    row(id, 'shape_changed', a, verified(id, A, B)),
  ]))
  assert.equal(out.actions[0].priority, 'P1')
  assertHold(out)
})
test('independent M5 inspected signals: changed HTML, stable structure remains P2', () => {
  const id = 'legitimate-content'
  const out = buildOfflineSelectorReviewQueue(report([
    row(id, 'content_changed_shape_stable', verified(id, B), verified(id, A)),
  ]))
  assert.equal(out.actions[0].priority, 'P2')
  assertHold(out)
})
test('independent M5 inspected signals: genuine unavailable capture remains P1', () => {
  const id = 'normal-unavailable'
  const out = buildOfflineSelectorReviewQueue(report([
    row(id, 'unavailable', unavailable(id), verified(id)),
  ]))
  assert.equal(out.actions[0].priority, 'P1')
  assertHold(out)
})
test('independent M5 inspected signals: no-baseline success stays P2 and review-only', () => {
  const id = 'new-manual-source'
  const out = buildOfflineSelectorReviewQueue(report([
    row(id, 'baseline_missing', verified(id)),
  ], false))
  assert.equal(out.actions[0].priority, 'P2')
  assertHold(out)
})
test('independent M5 inspected signals: disjoint 100-current plus 100-old union valid', () => {
  const changes = [
    ...Array.from({ length: 100 }, (_, i) => {
      const id = 'current-' + i
      return row(id, 'added', verified(id))
    }),
    ...Array.from({ length: 100 }, (_, i) => {
      const id = 'old-' + i
      return row(id, 'removed', null, verified(id))
    }),
  ]
  const input = report(changes)
  const prior = structuredClone(input)
  const out = buildOfflineSelectorReviewQueue(input)
  assert.equal(out.actions.length, 200)
  assert.equal(out.sourceCount, 100)
  assert.equal(out.driftCount, 200)
  assert.equal(out.actions.filter(a => a.priority === 'P1').length, 100)
  assert.equal(out.actions.filter(a => a.priority === 'P2').length, 100)
  assert.deepEqual(input, prior)
  assertHold(out)
})
test('independent M5 inspected signals: actual M1 HTML yields valid P3 without fake inspection counts', () => {
  const html = '<script type="application/ld+json">{"@type":"Product","offers":{}}</script>'
  const snapshot = {
    id: 'm1-real-inspection-synthetic',
    supermarket: 'fictional', kind: 'product',
    success: true, integrity: 'verified', manifestSha256: A,
    schemaOrgProduct: { type: 'abstain' },
    html: inspectHtml(html),
  }
  const original = structuredClone(snapshot)
  const comparison = compareInspections(
    { sourceCount: 1, sources: [snapshot] },
    { sourceCount: 1, sources: [structuredClone(snapshot)] },
  )
  const queue = buildOfflineSelectorReviewQueue(comparison)
  assert.equal(queue.actions.length, 1)
  assert.equal(queue.actions[0].priority, 'P3')
  assertHold(queue)
  assert.deepEqual(snapshot, original)
})
