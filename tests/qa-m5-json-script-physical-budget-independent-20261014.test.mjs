import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independent, entirely synthetic offline M5 admission checks; this file is
// identical on original and corrected frozen owner revisions. No retailer,
// participant, prices, network or remote file inputs.
const CAP = 8 * 1024 * 1024
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const input = (scripts = []) => ({
  id: 'invented-local-only',
  supermarket: 'fictional',
  kind: 'product',
  success: true,
  integrity: 'verified',
  manifestSha256: A,
  schemaOrgProduct: { type: 'abstain' },
  html: { hasNextData: false, jsonLd: [], applicationJsonScripts: scripts },
})
const script = (id, bytes) => ({ id, bytes })
const fail = source => {
  const prior = structuredClone(source)
  assert.throws(() => captureShape(source),
    err => err instanceof Error && err.message === 'Invalid or unbounded inspected HTML shape' &&
      !err.message.includes('invented-local-only'))
  assert.deepEqual(source, prior)
}
const success = source => {
  const prior = structuredClone(source)
  const out = captureShape(source)
  assert.equal(out.captureStatus, 'verified')
  assert.match(out.shapeSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(source, prior)
  return out
}
const assertPrivate = queue => {
  assert.equal(queue.productionReady, false)
  assert.equal(queue.m5Eligible, false)
  assert.equal(queue.rightsVerified, false)
  assert.equal(queue.selectorVerified, false)
  assert.ok(queue.actions.every(x =>
    x.productionEnabled === false &&
    x.rightsVerified === false &&
    x.selectorVerified === false &&
    /^[a-f0-9]{64}$/.test(x.sourceToken)))
  assert.doesNotMatch(JSON.stringify(queue), /invented-local-only|fictional/)
}
test('independent M5 budget: 8MiB+1 bytes in a single descriptor is rejected', () => {
  fail(input([script('application-state', CAP + 1)]))
})
test('independent M5 budget: Number.MAX_SAFE_INTEGER descriptor is rejected', () => {
  fail(input([script('state', Number.MAX_SAFE_INTEGER)]))
})
test('independent M5 budget: two individually valid 4MiB+1 bodies breach aggregate cap', () => {
  fail(input([script('state1', CAP / 2 + 1), script('state2', CAP / 2 + 1)]))
})
test('independent M5 budget: huge final descriptor cannot hide behind 127 zero-byte descriptors', () => {
  const scripts = Array.from({ length: 127 }, (_, i) => script('id' + i, 0))
  scripts.push(script('last', CAP + 1))
  fail(input(scripts))
})
test('independent M5 budget: 128 individually valid 8MiB bodies exceed aggregate budget', () => {
  fail(input(Array.from({ length: 128 }, (_, i) => script('state' + i, CAP))))
})
test('independent M5 budget: two descriptor IDs equal 8MiB+1 UTF-16 units are rejected', () => {
  fail(input([script('x'.repeat(CAP + 1), 0)]))
})
test('independent M5 budget: oversized Unicode descriptor ID cannot forge private shape', () => {
  fail(input([script('x'.repeat(CAP) + '💡', 0)]))
})
test('independent M5 budget: one physical 8MiB descriptor is valid shape-only', () => {
  // This is NOT a real 8MiB capture, just the pure in-memory scalar boundary.
  success(input([script('state', CAP)]))
})
test('independent M5 budget: aggregate exactly 8MiB across multiple descriptors is valid', () => {
  success(input([script('state', CAP / 2), script('other', CAP / 2)]))
})
test('independent M5 budget: 128 small script descriptors remain valid', () => {
  success(input(Array.from({ length: 128 }, (_, i) => script('x' + i, 1))))
})
test('independent M5 budget: empty string ID is canonical and valid at zero bytes', () => {
  success(input([script('', 0)]))
})
test('independent M5 budget: null ID with zero bytes remains valid', () => {
  success(input([script(null, 0)]))
})
test('independent M5 budget: a descriptor ID of exactly 8MiB units is admitted by pure shape sanity', () => {
  success(input([script('a'.repeat(CAP), 0)]))
})
test('independent M5 budget: fractional, negative, nonnumeric sizes remain rejected', () => {
  for (const bytes of [-1, -0.5, 0.5, '1', null, NaN, Infinity]) {
    fail(input([script('shape', bytes)]))
  }
})
test('independent M5 budget: null/zero and positive sizes cannot mutate input state', () => {
  const source = input([script(null, 0), script('small', 10)])
  const before = structuredClone(source)
  const one = success(source)
  const two = success(source)
  assert.deepEqual(one, two)
  assert.deepEqual(source, before)
})
test('independent M5 budget: bad history rejects comparison before any reviewer output', () => {
  const now = input([script('new', 1)])
  const old = input([script('untrusted', CAP + 1)])
  assert.throws(() => compareInspections(
    { sourceCount: 1, sources: [now] },
    { sourceCount: 1, sources: [old] },
  ), /Invalid or unbounded inspected HTML shape/)
})
test('independent M5 budget: unchanged credible sources retain P3 manual-only review', () => {
  const now = input([script('small', 200)])
  const old = structuredClone(now)
  const report = compareInspections(
    { sourceCount: 1, sources: [now] },
    { sourceCount: 1, sources: [old] },
  )
  const output = buildOfflineSelectorReviewQueue(report)
  assert.equal(output.actions.length, 1)
  assert.equal(output.actions[0].priority, 'P3')
  assertPrivate(output)
})
test('independent M5 budget: genuine changed snapshot remains P2 private manual review', () => {
  const now = input([script('small', 200)])
  const old = input([script('small', 200)])
  now.manifestSha256 = B
  const comparison = compareInspections(
    { sourceCount: 1, sources: [now] },
    { sourceCount: 1, sources: [old] },
  )
  const out = buildOfflineSelectorReviewQueue(comparison)
  assert.equal(out.actions[0].priority, 'P2')
  assertPrivate(out)
})
test('independent M5 budget: canonical tiny real inspectHtml output preserves P3', () => {
  const html = '<html><script type="application/json" id="state">{"status":"fake"}</script></html>'
  const sha = createHash('sha256').update(html).digest('hex')
  const inspected = { ...input(), manifestSha256: sha, html: inspectHtml(html) }
  const report = compareInspections(
    { sourceCount: 1, sources: [inspected] },
    { sourceCount: 1, sources: [structuredClone(inspected)] },
  )
  const out = buildOfflineSelectorReviewQueue(report)
  assert.equal(out.actions[0].priority, 'P3')
  assertPrivate(out)
})
