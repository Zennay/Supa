import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Same independently authored 16 synthetic tests on original and corrected
// frozen product source. No live retailer, prices, users, captures or network.
const A = 'a'.repeat(64), B = 'b'.repeat(64)
const malformed = (type = [], keys = []) => ({
  type, keys, parseError: true,
})
const verified = (ld = []) => ({
  id: 'fictional-m1-jsonld',
  supermarket: 'fictional',
  kind: 'product',
  success: true,
  integrity: 'verified',
  manifestSha256: A,
  schemaOrgProduct: { type: 'abstain' },
  html: {
    hasNextData: false,
    jsonLd: ld,
    applicationJsonScripts: [{ id: null, bytes: 0 }],
  },
})
const reject = source => {
  const before = structuredClone(source)
  assert.throws(() => captureShape(source), err =>
    err instanceof Error &&
    err.message === 'Invalid or unbounded inspected HTML shape' &&
    !err.message.includes('fictional-m1-jsonld'))
  assert.deepEqual(source, before)
}
const allow = source => {
  const before = structuredClone(source)
  const value = captureShape(source)
  assert.equal(value.captureStatus, 'verified')
  assert.match(value.shapeSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(source, before)
  return value
}
const comparison = (now, old) => compareInspections(
  { sourceCount: 1, sources: [now] },
  { sourceCount: 1, sources: [old] },
)
const review = report => {
  const out = buildOfflineSelectorReviewQueue(report)
  assert.equal(out.productionReady, false)
  assert.equal(out.m5Eligible, false)
  assert.equal(out.rightsVerified, false)
  assert.equal(out.selectorVerified, false)
  assert.ok(out.actions.every(x => x.productionEnabled === false &&
    x.rightsVerified === false && x.selectorVerified === false))
  assert.doesNotMatch(JSON.stringify(out), /fictional-m1-jsonld|example.invalid/)
  return out
}
test('independent JSON-LD: parseError=true cannot co-exist with Product type', () => {
  reject(verified([malformed(['Product'], [])]))
})
test('independent JSON-LD: parseError=true cannot co-exist with @type key', () => {
  reject(verified([malformed([], ['@type'])]))
})
test('independent JSON-LD: parseError=true cannot co-exist with offers key', () => {
  reject(verified([malformed([], ['offers'])]))
})
test('independent JSON-LD: parseError=true cannot co-exist with type and keys', () => {
  reject(verified([malformed(['Product'], ['@type', 'offers'])]))
})
test('independent JSON-LD: forged later record must not hide behind a valid first record', () => {
  reject(verified([
    { type: ['Product'], keys: ['@type'], },
    malformed(['Product'], ['offers']),
  ]))
})
test('independent JSON-LD: 128th record cannot contain impossible parse metadata', () => {
  const rows = Array.from({ length: 127 }, () => malformed([], []))
  rows.push(malformed(['Product'], []))
  reject(verified(rows))
})
test('independent JSON-LD: parseError=true with empty type and keys is canonical', () => {
  const value = allow(verified([malformed([], [])]))
  assert.equal(value.jsonLdCount, 1)
  assert.equal(value.jsonLdParseErrors, 1)
})
test('independent JSON-LD: 128 canonical malformed records are still bounded and accepted', () => {
  const value = allow(verified(Array.from({ length: 128 }, () => malformed())))
  assert.equal(value.jsonLdCount, 128)
  assert.equal(value.jsonLdParseErrors, 128)
})
test('independent JSON-LD: valid Product type and relevant keys without parseError stay valid', () => {
  const value = allow(verified([{ type: ['Product'], keys: ['@type', 'offers'] }]))
  assert.equal(value.jsonLdCount, 1)
  assert.equal(value.jsonLdParseErrors, 0)
})
test('independent JSON-LD: empty script descriptor list and valid parsed JSON-LD stay valid', () => {
  const src = verified([{ type: ['Product'], keys: ['@type'] }])
  src.html.applicationJsonScripts = []
  allow(src)
})
test('independent JSON-LD: cannot forge failed parser in current side of a comparison', () => {
  const now = verified([malformed(['Product'], [])])
  const previous = verified([malformed()])
  assert.throws(() => comparison(now, previous), /Invalid or unbounded inspected HTML shape/)
})
test('independent JSON-LD: cannot forge failed parser in baseline side of a comparison', () => {
  const now = verified([malformed()])
  const previous = verified([malformed([], ['offers'])])
  assert.throws(() => comparison(now, previous), /Invalid or unbounded inspected HTML shape/)
})
test('independent JSON-LD: real malformed inline M1 HTML is canonical and private P3', () => {
  const html = '<script type="application/ld+json">{malformed-json</script>'
  const source = { ...verified(), manifestSha256: createHash('sha256').update(html).digest('hex'),
    html: inspectHtml(html) }
  assert.equal(source.html.jsonLd[0].parseError, true)
  assert.deepEqual(source.html.jsonLd[0].type, [])
  assert.deepEqual(source.html.jsonLd[0].keys, [])
  const out = review(comparison(source, structuredClone(source)))
  assert.deepEqual(out.actions.map(x => [x.status, x.priority]), [['unchanged', 'P3']])
})
test('independent JSON-LD: real repaired inline M1 HTML produces manual P1 structural change', () => {
  const badHtml = '<script type="application/ld+json">{malformed-json</script>'
  const goodHtml = '<script type="application/ld+json">{"@type":"Product","offers":{}}</script>'
  const asSource = html => ({
    ...verified(), manifestSha256: createHash('sha256').update(html).digest('hex'),
    html: inspectHtml(html),
  })
  const out = review(comparison(asSource(goodHtml), asSource(badHtml)))
  assert.deepEqual(out.actions.map(x => [x.status, x.priority]), [['shape_changed', 'P1']])
})
test('independent JSON-LD: blank successful script list preserves manual P3', () => {
  const out = review(comparison(verified([]), verified([])))
  assert.equal(out.actions[0].priority, 'P3')
})
test('independent JSON-LD: incompatible parseError types remain invalid', () => {
  for (const flag of [false, null, 0, 1, 'true']) {
    const source = verified([{ type: [], keys: [], parseError: flag }])
    reject(source)
  }
})
