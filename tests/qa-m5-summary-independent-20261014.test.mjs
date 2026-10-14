import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independent, offline-only fictional source IDs and data: no actual prices,
// supermarkts, retailer HTTP, captured pages, or private participant inputs.
const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64)
const ALL_STATUSES = [
  'unavailable', 'origin_changed', 'removed', 'shape_changed',
  'added', 'baseline_missing', 'content_changed_shape_stable', 'unchanged',
]
const verified = (id, snapshotSha256 = A, shapeSha256 = B, supermarket = 'fictional') => ({
  id, supermarket, kind: 'product', captureStatus: 'verified',
  snapshotSha256, shapeSha256, schemaOrgStatus: 'abstain',
  hasNextData: false, jsonLdCount: 0, jsonLdParseErrors: 0,
})
const unavailable = id => ({
  id, supermarket: 'fictional', kind: 'product', captureStatus: 'unavailable',
  snapshotSha256: null, shapeSha256: null, schemaOrgStatus: 'unknown',
})
const change = (id, status, current, baseline = null) => ({ id, status, current, baseline })
const DRIFT = new Set(['unavailable', 'origin_changed', 'removed', 'shape_changed', 'added'])
const report = (changes, baselineProvided = true) => ({
  contractVersion: 1, mode: 'offline_capture_signature_review_only',
  productionReady: false, m5Eligible: false, reviewerActionRequired: true,
  baselineProvided, changes,
  captureCount: changes.filter(c => c.current !== null).length,
  driftCount: changes.filter(c => DRIFT.has(c.status)).length,
})
const queue = x => buildOfflineSelectorReviewQueue(x)
const sum = values => Object.values(values).reduce((a, b) => a + b, 0)
function checkSummary(out) {
  assert.equal(out.summary.actionCount, out.actions.length)
  assert.deepEqual(Object.keys(out.summary.priorityCounts).sort(), ['P1', 'P2', 'P3'])
  assert.deepEqual(Object.keys(out.summary.statusCounts).sort(), [...ALL_STATUSES].sort())
  assert.equal(sum(out.summary.priorityCounts), out.actions.length)
  assert.equal(sum(out.summary.statusCounts), out.actions.length)
  for (const x of ['selectorVerified', 'rightsVerified', 'productionReady', 'm5Eligible']) {
    assert.equal(out[x], false)
  }
  assert.ok(out.actions.every(x => x.selectorVerified === false &&
    x.rightsVerified === false && x.productionEnabled === false &&
    /^[a-f0-9]{64}$/.test(x.sourceToken)))
}
const frozenSeven = () => [
  change('failed-private', 'unavailable', unavailable('failed-private'), verified('failed-private')),
  change('other-origin', 'origin_changed', verified('other-origin', A, B, 'fictional-new'), verified('other-origin')),
  change('historical-removed', 'removed', null, verified('historical-removed')),
  change('new-structure', 'shape_changed', verified('new-structure', B, C), verified('new-structure')),
  change('new-manual-source', 'added', verified('new-manual-source')),
  change('content-only', 'content_changed_shape_stable', verified('content-only', B), verified('content-only')),
  change('stable-history', 'unchanged', verified('stable-history'), verified('stable-history')),
]

test('independent summary: empty offline queue declares all 11 zero keys', () => {
  const value = queue(report([], false))
  checkSummary(value)
  assert.equal(value.summary.actionCount, 0)
  assert.deepEqual(value.summary.priorityCounts, { P1: 0, P2: 0, P3: 0 })
  for (const status of ALL_STATUSES) assert.equal(value.summary.statusCounts[status], 0)
})
test('independent summary: count all seven comparable statuses and preserve absent eighth zero', () => {
  const result = queue(report(frozenSeven()))
  checkSummary(result)
  assert.equal(result.summary.actionCount, 7)
  assert.deepEqual(result.summary.priorityCounts, { P1: 4, P2: 2, P3: 1 })
  for (const status of ALL_STATUSES) {
    assert.equal(result.summary.statusCounts[status], status === 'baseline_missing' ? 0 : 1)
  }
})
test('independent summary: absent baseline P1 fail and P2 new source stay distinct', () => {
  const input = report([
    change('failed', 'unavailable', unavailable('failed')),
    change('new', 'baseline_missing', verified('new')),
  ], false)
  const out = queue(input)
  checkSummary(out)
  assert.equal(out.summary.priorityCounts.P1, 1)
  assert.equal(out.summary.priorityCounts.P2, 1)
  assert.equal(out.summary.statusCounts.baseline_missing, 1)
  assert.equal(out.summary.statusCounts.unavailable, 1)
})
test('independent summary: permutation cannot change category totals or sorted tokens', () => {
  const arr = frozenSeven()
  const a = queue(report(arr)), b = queue(report([...arr].reverse()))
  checkSummary(a)
  assert.deepEqual(a, b)
})
test('independent summary: injected arbitrary forged caller summary cannot change verified output', () => {
  const input = report(frozenSeven())
  const original = queue(input)
  input.summary = {
    actionCount: -7, priorityCounts: { P1: 9999999, P2: 9, P3: -8 },
    statusCounts: { removed: 999 }, rawEmail: 'not-real@example.invalid',
    rawSourceId: 'private-source',
  }
  const before = structuredClone(input)
  const out = queue(input)
  assert.deepEqual(out, original)
  checkSummary(out)
  assert.deepEqual(input, before)
  assert.doesNotMatch(JSON.stringify(out), /private-source|not-real@example.invalid/)
})
test('independent summary: no source IDs, URLs, prices or HTML in aggregate payload', () => {
  const out = queue(report(frozenSeven()))
  checkSummary(out)
  const text = JSON.stringify(out.summary)
  assert.doesNotMatch(text, /failed-private|new-manual-source|historical-removed|https?:|€|@|<script|price|productName/i)
})
test('independent summary: 100 current + 100 disjoint historical remains bounded 200', () => {
  const all = [
    ...Array.from({ length: 100 }, (_, i) => {
      const id = 'present-' + i
      return change(id, 'added', verified(id))
    }),
    ...Array.from({ length: 100 }, (_, i) => {
      const id = 'absent-' + i
      return change(id, 'removed', null, verified(id))
    }),
  ]
  const src = report(all)
  const frozen = structuredClone(src)
  const out = queue(src)
  checkSummary(out)
  assert.equal(out.summary.actionCount, 200)
  assert.deepEqual(out.summary.priorityCounts, { P1: 100, P2: 100, P3: 0 })
  assert.equal(out.summary.statusCounts.added, 100)
  assert.equal(out.summary.statusCounts.removed, 100)
  assert.deepEqual(src, frozen)
})
test('independent summary: canonical P3 real M1 HTML inspection keeps one P3 and zero others', () => {
  const source = {
    id: 'fictional-inline-source', supermarket: 'fictional', kind: 'product',
    success: true, integrity: 'verified', manifestSha256: A,
    schemaOrgProduct: { type: 'abstain' },
    html: inspectHtml('<script type="application/ld+json">{"@type":"Product"}</script>'),
  }
  const inspected = compareInspections(
    { sourceCount: 1, sources: [source] },
    { sourceCount: 1, sources: [structuredClone(source)] },
  )
  const result = queue(inspected)
  checkSummary(result)
  assert.equal(result.summary.priorityCounts.P3, 1)
  assert.equal(result.summary.statusCounts.unchanged, 1)
})
test('independent summary: cannot launder malformed sparse actions via fake counts', () => {
  const input = report([])
  input.changes = new Array(2)
  input.summary = { actionCount: 0, priorityCounts: { P1: 0, P2: 0, P3: 0 } }
  assert.throws(() => queue(input), /^Error: Invalid offline capture comparison report$/)
})
test('independent summary: all generated review action statuses are canonical', () => {
  const out = queue(report(frozenSeven()))
  checkSummary(out)
  for (const item of out.actions) assert.ok(ALL_STATUSES.includes(item.status))
  assert.deepEqual(out.actions.map(x => x.priority), [...out.actions.map(x => x.priority)].sort())
})
test('independent summary: positive report with empty historical sample is P2 no baseline', () => {
  const id = 'new-no-old-data'
  const out = queue(report([change(id, 'baseline_missing', verified(id))], false))
  checkSummary(out)
  assert.equal(out.summary.priorityCounts.P2, 1)
  assert.equal(out.summary.statusCounts.baseline_missing, 1)
})
test('independent summary: single current unavailable with no past snapshot still P1', () => {
  const id = 'failed-only'
  const out = queue(report([change(id, 'unavailable', unavailable(id))], false))
  checkSummary(out)
  assert.equal(out.summary.priorityCounts.P1, 1)
  assert.equal(out.summary.statusCounts.unavailable, 1)
})
test('independent summary: malformed source must not produce apparently valid totals', () => {
  const x = frozenSeven()
  x[0].current.jsonLdCount = 1
  const input = report(x)
  input.summary = { actionCount: 7 }
  assert.throws(() => queue(input), /^Error: Invalid offline capture comparison report$/)
})
