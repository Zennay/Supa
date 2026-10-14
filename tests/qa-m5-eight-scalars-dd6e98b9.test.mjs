import assert from 'node:assert/strict'
import test from 'node:test'

import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independent synthetic offline M1 inspector contract acceptance. No store
// network calls, real captures/prices, source rights or production M5 use.
const hash = 'a'.repeat(64)
function source() {
  return {
    id: 'fictional-source-id', supermarket: 'fictional-market', kind: 'product',
    success: true, integrity: 'verified', manifestSha256: hash,
    schemaOrgProduct: { type: 'abstain' },
    html: {
      hasNextData: false,
      jsonLd: [{ type: ['Product'], keys: ['@type', 'offers'] }],
      applicationJsonScripts: [{ id: null, bytes: 0 }],
    },
  }
}
function compare(left, right) {
  const before = structuredClone([left, right])
  const report = compareInspections(
    { sourceCount: 1, sources: [left] },
    { sourceCount: 1, sources: [right] },
  )
  assert.deepEqual([left, right], before, 'M5 review must not alter inspection')
  assert.equal(report.productionReady, false)
  assert.equal(report.m5Eligible, false)
  return report
}
function expectCanonicalRejection(change) {
  const original = source()
  const changed = source()
  change(changed)
  const before = structuredClone(changed)
  assert.throws(() => captureShape(changed),
    /Invalid or unbounded inspected HTML shape/,
    'noncanonical M1 inspector output must not be accepted')
  assert.deepEqual(changed, before, 'failed preflight must not mutate input')
}

test('M5 shape positive: canonical real M1 inspectHtml booleans and script descriptors remain valid', () => {
  const html = '<script type="application/ld+json">{"@type":"Product","offers":{}}</script>' +
    '<script type="application/json" id="state">{"hello":true}</script>' +
    '<script id="__NEXT_DATA__" type="text/plain">x</script>'
  const inspectorHtml = inspectHtml(html)
  assert.equal(inspectorHtml.hasNextData, true)
  assert.deepEqual(inspectorHtml.applicationJsonScripts, [{ id: 'state', bytes: 14 }])
  const left = source()
  left.html = inspectorHtml
  const report = compare(left, structuredClone(left))
  assert.equal(report.changes[0].status, 'unchanged')
  const queue = buildOfflineSelectorReviewQueue(report)
  assert.equal(queue.actions[0].priority, 'P3')
  assert.equal(queue.rightsVerified, false)
  assert.equal(queue.selectorVerified, false)
  assert.equal(queue.productionReady, false)
  assert.equal(queue.m5Eligible, false)
})

test('M5 shape positive: real malformed JSON-LD parseError=true remains tracked as shape evidence', () => {
  const valid = source()
  const bad = source()
  // Different HTML bytes must have a different verified source SHA; sharing
  // the earlier fixture's static SHA is impossible under canonical M1.
  bad.manifestSha256 = 'b'.repeat(64)
  bad.html = inspectHtml('<script type="application/ld+json">{not-json}</script>')
  assert.equal(bad.html.jsonLd[0].parseError, true)
  const report = compare(bad, valid)
  assert.equal(report.changes[0].status, 'shape_changed')
  assert.equal(report.changes[0].current.jsonLdParseErrors, 1)
  assert.equal(buildOfflineSelectorReviewQueue(report).actions[0].priority, 'P1')
})

test('M5 shape positive: canonical null-id and positive-byte application script records remain valid', () => {
  const left = source()
  left.html.applicationJsonScripts = [{ id: null, bytes: 0 }, { id: 'state', bytes: 22 }]
  const before = structuredClone(left)
  const shape = captureShape(left)
  assert.match(shape.shapeSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(left, before)
  const queue = buildOfflineSelectorReviewQueue(compare(left, left))
  assert.equal(queue.actions.length, 1)
  assert.equal(queue.actions[0].priority, 'P3')
})

test('M5 shape RED: absent or stringified hasNextData cannot silently become false', () => {
  for (const mutate of [
    s => { delete s.html.hasNextData },
    s => { s.html.hasNextData = 'false' },
    s => { s.html.hasNextData = 0 },
  ]) expectCanonicalRejection(mutate)
})

test('M5 shape RED: nonboolean JSON-LD parseError cannot masquerade as success', () => {
  for (const v of ['true', 1, false]) {
    expectCanonicalRejection(s => { s.html.jsonLd[0].parseError = v })
  }
})

test('M5 shape RED: missing application JSON descriptor id/bytes is not canonical', () => {
  for (const v of [{}, { id: null }, { bytes: 0 }, { id: 7, bytes: 0 }]) {
    expectCanonicalRejection(s => { s.html.applicationJsonScripts = [v] })
  }
})

test('M5 shape RED: array-valued application JSON descriptor is not canonical', () => {
  expectCanonicalRejection(s => { s.html.applicationJsonScripts = [[null, 0]] })
})

test('M5 shape RED: malformed application JSON byte counts cannot be normalized', () => {
  for (const bytes of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '12', Number.MAX_SAFE_INTEGER + 1]) {
    expectCanonicalRejection(s => { s.html.applicationJsonScripts = [{ id: 'state', bytes }] })
  }
})
