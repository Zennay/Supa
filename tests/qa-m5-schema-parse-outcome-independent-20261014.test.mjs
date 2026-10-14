import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independent source-provenance acceptance, same bytes on original and fixed.
// All fixtures are in-memory fiction; no retailer, participant, prices or I/O.
const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const source = (schemaOrgProduct = { type: 'abstain' }) => ({
  id: 'invented-schema-source',
  supermarket: 'fictional',
  kind: 'product',
  success: true,
  integrity: 'verified',
  manifestSha256: A,
  schemaOrgProduct,
  html: { hasNextData: false, jsonLd: [], applicationJsonScripts: [] },
})
const fail = input => {
  const before = structuredClone(input)
  assert.throws(() => captureShape(input), err =>
    err instanceof Error &&
    err.message === 'Invalid inspected Schema.org parse result' &&
    !err.message.includes('invented-schema-source'))
  assert.deepEqual(input, before)
}
const allow = input => {
  const prior = structuredClone(input)
  const result = captureShape(input)
  assert.equal(result.captureStatus, 'verified')
  assert.match(result.shapeSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(input, prior)
  return result
}
const comparison = (current, baseline) => compareInspections(
  { sourceCount: 1, sources: [current] },
  { sourceCount: 1, sources: [baseline] },
)
const checkPrivate = report => {
  const out = buildOfflineSelectorReviewQueue(report)
  for (const key of ['productionReady', 'm5Eligible', 'rightsVerified', 'selectorVerified']) {
    assert.equal(out[key], false)
  }
  assert.ok(out.actions.every(x => x.productionEnabled === false &&
    x.rightsVerified === false && x.selectorVerified === false))
  assert.doesNotMatch(JSON.stringify(out), /invented-schema-source|fictional/)
  return out
}
test('independent M5 schema: missing own successful parser result must fail', () => {
  const x = source()
  delete x.schemaOrgProduct
  fail(x)
})
test('independent M5 schema: null parser result cannot imply abstain', () => {
  fail(source(null))
})
test('independent M5 schema: array result cannot imply abstain', () => {
  fail(source([{ type: 'abstain' }]))
})
test('independent M5 schema: string result cannot imply abstain', () => {
  fail(source('abstain'))
})
test('independent M5 schema: numeric result cannot imply abstain', () => {
  fail(source(0))
})
test('independent M5 schema: missing own parse type never implies abstain', () => {
  fail(source({}))
})
test('independent M5 schema: forged parser decision is rejected', () => {
  for (const type of ['verified', 'candidate_observation', 'unknown', '', null, true, 1]) {
    fail(source({ type }))
  }
})
test('independent M5 schema: own inherited type is not an M1 parser decision', () => {
  const x = source()
  x.schemaOrgProduct = Object.create({ type: 'abstain' })
  assert.throws(() => captureShape(x), /Invalid inspected Schema.org parse result/)
})
test('independent M5 schema: inherited parser result itself is not a parse decision', () => {
  const x = source()
  delete x.schemaOrgProduct
  Object.setPrototypeOf(x, { schemaOrgProduct: { type: 'abstain' } })
  assert.throws(() => captureShape(x), /Invalid inspected Schema.org parse result/)
})
test('independent M5 schema: top-level getter cannot fabricate parser evidence', () => {
  const x = source()
  let invoked = 0
  Object.defineProperty(x, 'schemaOrgProduct', {
    configurable: true, get() { invoked++; throw new Error('secret getter') },
  })
  assert.throws(() => captureShape(x), /^Error: Invalid inspected Schema.org parse result$/)
  assert.equal(invoked, 0)
})
test('independent M5 schema: nested type getter cannot fabricate parser evidence', () => {
  const x = source()
  let invoked = 0
  Object.defineProperty(x.schemaOrgProduct, 'type', {
    configurable: true, get() { invoked++; throw new Error('secret getter') },
  })
  assert.throws(() => captureShape(x), /^Error: Invalid inspected Schema.org parse result$/)
  assert.equal(invoked, 0)
})
test('independent M5 schema: unsuccessful capture cannot have successful parser metadata', () => {
  const x = source({ type: 'abstain' })
  x.success = false
  fail(x)
})
test('independent M5 schema: unsuccessful capture cannot have explicit null decision', () => {
  const x = source(null)
  x.success = false
  fail(x)
})
test('independent M5 schema: unsuccessful capture without parser metadata stays unavailable', () => {
  const x = source()
  x.success = false
  delete x.schemaOrgProduct
  const out = captureShape(x)
  assert.equal(out.captureStatus, 'unavailable')
  assert.equal(out.schemaOrgStatus, 'unknown')
})
test('independent M5 schema: unsuccessful capture with own undefined decision remains canonical', () => {
  const x = source()
  x.schemaOrgProduct = undefined
  x.success = false
  const out = captureShape(x)
  assert.equal(out.captureStatus, 'unavailable')
})
test('independent M5 schema: real canonical abstain remains private P3', () => {
  const now = source()
  const report = comparison(now, structuredClone(now))
  const out = checkPrivate(report)
  assert.equal(out.actions[0].priority, 'P3')
  assert.equal(report.changes[0].current.schemaOrgStatus, 'abstain')
})
test('independent M5 schema: real candidate observation remains manual only P2 without baseline', () => {
  const now = source({ type: 'observation', name: 'never-expose-example' })
  const report = compareInspections({ sourceCount: 1, sources: [now] })
  const out = checkPrivate(report)
  assert.equal(report.changes[0].current.schemaOrgStatus, 'candidate_observation')
  assert.equal(out.actions[0].priority, 'P2')
  assert.doesNotMatch(JSON.stringify(out), /never-expose-example/)
})
test('independent M5 schema: nested candidate payload getter is never touched', () => {
  const x = source({ type: 'observation' })
  let invoked = 0
  Object.defineProperty(x.schemaOrgProduct, 'product', {
    get() { invoked++; throw new Error('secret payload getter') },
  })
  assert.equal(captureShape(x).schemaOrgStatus, 'candidate_observation')
  assert.equal(invoked, 0)
})
test('independent M5 schema: actual fictional M1 HTML inspection stays valid P3', () => {
  const html = '<script type="application/ld+json">{malformed JSON</script>'
  const x = source()
  x.manifestSha256 = createHash('sha256').update(html).digest('hex')
  x.html = inspectHtml(html)
  assert.equal(x.html.jsonLd[0].parseError, true)
  const out = checkPrivate(comparison(x, structuredClone(x)))
  assert.equal(out.actions[0].priority, 'P3')
})
test('independent M5 schema: genuine corrected candidate decision makes P1 when HTML changes', () => {
  const now = source({ type: 'observation' })
  const old = source({ type: 'abstain' })
  now.manifestSha256 = B
  const out = checkPrivate(comparison(now, old))
  assert.equal(out.actions[0].status, 'shape_changed')
  assert.equal(out.actions[0].priority, 'P1')
})
test('independent M5 schema: failed capture remains P1 in no-baseline private review', () => {
  const x = source()
  x.success = false
  delete x.schemaOrgProduct
  const report = compareInspections({ sourceCount: 1, sources: [x] })
  const out = checkPrivate(report)
  assert.equal(out.actions[0].priority, 'P1')
})
