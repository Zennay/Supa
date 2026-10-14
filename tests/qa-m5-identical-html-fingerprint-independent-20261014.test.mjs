import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independent synthetic offline M5 pure-API QA. No retailer data or HTTP.
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const verified = (id, html = A, shape = B, schema = 'abstain', supermarket = 'fictional') => ({
  id, supermarket, kind: 'product', captureStatus: 'verified',
  snapshotSha256: html, shapeSha256: shape, schemaOrgStatus: schema,
  hasNextData: false, jsonLdCount: 0, jsonLdParseErrors: 0,
})
const unavailable = (id) => ({
  id, supermarket: 'fictional', kind: 'product', captureStatus: 'unavailable',
  snapshotSha256: null, shapeSha256: null, schemaOrgStatus: 'unknown',
})
const row = (id, status, current, baseline = null) => ({
  id, status, current, baseline,
})
const driftStatuses = new Set(['unavailable', 'origin_changed', 'removed', 'shape_changed', 'added'])
const report = (changes, baselineProvided = true) => ({
  contractVersion: 1, mode: 'offline_capture_signature_review_only',
  productionReady: false, m5Eligible: false, reviewerActionRequired: true,
  baselineProvided, changes,
  captureCount: changes.filter(x => x.current !== null).length,
  driftCount: changes.filter(x => driftStatuses.has(x.status)).length,
})
const reject = (r) => assert.throws(
  () => buildOfflineSelectorReviewQueue(r),
  /^Error: Invalid offline capture comparison report$/,
)
const hold = (out) => {
  for (const key of ['rightsVerified', 'selectorVerified', 'productionReady', 'm5Eligible']) {
    assert.equal(out[key], false)
  }
  assert.ok(out.actions.every(x => x.productionEnabled === false &&
    x.rightsVerified === false && x.selectorVerified === false &&
    /^[a-f0-9]{64}$/.test(x.sourceToken)))
}
const drift = (id, current, historical) => report([
  row(id, 'shape_changed', current, historical),
])

test('QA identical HTML: forged shape digest difference is not P1 source drift', () => {
  const id = 'fake-shape'
  const input = drift(id, verified(id, A, B), verified(id, A, C))
  const saved = structuredClone(input)
  reject(input)
  assert.deepEqual(input, saved)
})

test('QA identical HTML: forged Schema.org status difference cannot become P1', () => {
  const id = 'fake-schema'
  reject(drift(id, verified(id, A, B, 'abstain'),
    verified(id, A, B, 'candidate_observation')))
})

test('QA identical HTML: simultaneous forged shape and schema drift rejected', () => {
  const id = 'fake-both'
  reject(drift(id, verified(id, A, B, 'abstain'),
    verified(id, A, C, 'candidate_observation')))
})

test('QA identical HTML: reversed phantom fingerprint difference also rejected', () => {
  const id = 'reverse-phantom'
  reject(drift(id, verified(id, A, C), verified(id, A, B)))
})

test('QA identical HTML: no output or source path leak on forged P1', () => {
  const id = 'private-review-sentinel-unique'
  const input = drift(id, verified(id, A, C), verified(id, A, B))
  assert.throws(() => buildOfflineSelectorReviewQueue(input),
    err => err instanceof Error &&
      err.message === 'Invalid offline capture comparison report' &&
      !err.message.includes(id))
})

test('QA changed HTML: real shape-digest change remains review-only P1', () => {
  const id = 'legitimate-new-html-shape'
  const out = buildOfflineSelectorReviewQueue(drift(id,
    verified(id, A, C), verified(id, B, B)))
  assert.deepEqual(out.actions.map(x => [x.status, x.priority]), [['shape_changed', 'P1']])
  hold(out)
})

test('QA changed HTML: real Schema.org change remains review-only P1', () => {
  const id = 'legitimate-new-html-schema'
  const out = buildOfflineSelectorReviewQueue(drift(id,
    verified(id, A, B, 'candidate_observation'),
    verified(id, B, B, 'abstain')))
  assert.equal(out.actions[0].priority, 'P1')
  hold(out)
})

test('QA changed HTML: stable shape but different content remains P2', () => {
  const id = 'new-html-shape-stable'
  const out = buildOfflineSelectorReviewQueue(report([
    row(id, 'content_changed_shape_stable', verified(id, B), verified(id, A)),
  ]))
  assert.deepEqual(out.actions.map(x => [x.status, x.priority]),
    [['content_changed_shape_stable', 'P2']])
  hold(out)
})

test('QA identical HTML: stable identical capture still maps to P3', () => {
  const id = 'stable-capture'
  const out = buildOfflineSelectorReviewQueue(report([
    row(id, 'unchanged', verified(id), verified(id)),
  ]))
  assert.equal(out.actions[0].priority, 'P3')
  hold(out)
})

test('QA identical HTML: retailer origin drift is still P1', () => {
  const id = 'different-retailer'
  const out = buildOfflineSelectorReviewQueue(report([
    row(id, 'origin_changed', verified(id, A, B, 'abstain', 'other-fictional'), verified(id)),
  ]))
  assert.equal(out.actions[0].priority, 'P1')
  hold(out)
})

test('QA missing HTML: same ID failed current capture remains P1 unavailable', () => {
  const id = 'failed-capture'
  const out = buildOfflineSelectorReviewQueue(report([
    row(id, 'unavailable', unavailable(id), verified(id)),
  ]))
  assert.equal(out.actions[0].priority, 'P1')
  hold(out)
})

test('QA absent baseline: successful capture remains manual-only P2', () => {
  const id = 'no-history'
  const out = buildOfflineSelectorReviewQueue(report([
    row(id, 'baseline_missing', verified(id)),
  ], false))
  assert.equal(out.actions[0].priority, 'P2')
  hold(out)
})

test('QA identical HTML: physical disjoint 100 current + 100 historical still valid', () => {
  const additions = Array.from({ length: 100 }, (_, i) => {
    const id = 'current-' + i
    return row(id, 'added', verified(id))
  })
  const removals = Array.from({ length: 100 }, (_, i) => {
    const id = 'old-' + i
    return row(id, 'removed', null, verified(id))
  })
  const input = report([...removals, ...additions])
  const original = structuredClone(input)
  const out = buildOfflineSelectorReviewQueue(input)
  assert.equal(out.actions.length, 200)
  assert.equal(out.sourceCount, 100)
  assert.equal(out.driftCount, 200)
  assert.equal(out.actions.filter(x => x.priority === 'P1').length, 100)
  assert.equal(out.actions.filter(x => x.priority === 'P2').length, 100)
  assert.deepEqual(input, original)
  hold(out)
})
