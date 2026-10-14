import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independent offline synthetic Product-capable JSON-LD evidence QA, same
// suite on frozen original and corrected source; no real retailer/user/prices.
const A = 'a'.repeat(64), B = 'b'.repeat(64)
const parsed = (type, keys = ['@type']) => ({ type: [type], keys })
const verified = (jsonLd = [parsed('Product')], schema = { type: 'observation', observation: {} }) => ({
  id: 'invented-product-evidence',
  supermarket: 'fictional', kind: 'product',
  success: true, integrity: 'verified', manifestSha256: A,
  schemaOrgProduct: schema,
  html: { hasNextData: false, jsonLd, applicationJsonScripts: [] },
})
const failure = source => {
  const copy = structuredClone(source)
  assert.throws(() => captureShape(source), err =>
    err instanceof Error && err.message === 'Invalid inspected Schema.org parse result' &&
    !err.message.includes('invented-product-evidence'))
  assert.deepEqual(source, copy)
}
const valid = source => {
  const before = structuredClone(source)
  const out = captureShape(source)
  assert.equal(out.captureStatus, 'verified')
  assert.match(out.shapeSha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(source, before)
  return out
}
const review = (current, baseline = null) => {
  const report = compareInspections(
    { sourceCount: 1, sources: [current] },
    baseline ? { sourceCount: 1, sources: [baseline] } : null,
  )
  const result = buildOfflineSelectorReviewQueue(report)
  for (const key of ['m5Eligible', 'productionReady', 'rightsVerified', 'selectorVerified']) {
    assert.equal(result[key], false)
  }
  assert.ok(result.actions.every(x => x.productionEnabled === false &&
    x.rightsVerified === false && x.selectorVerified === false &&
    /^[a-f0-9]{64}$/.test(x.sourceToken)))
  assert.doesNotMatch(JSON.stringify(result), /invented-product-evidence|fictional|secret-product/)
  return result
}
test('independent M5 Product evidence: plain WebPage cannot justify Product observation', () => {
  failure(verified([parsed('WebPage')]))
})
test('independent M5 Product evidence: Offer alone cannot justify Product observation', () => {
  failure(verified([parsed('Offer')]))
})
test('independent M5 Product evidence: ItemList alone cannot justify Product observation', () => {
  failure(verified([parsed('ItemList')]))
})
test('independent M5 Product evidence: multiple unrelated parsed types cannot justify candidate', () => {
  failure(verified([parsed('WebPage'), parsed('Offer'), parsed('ItemList')]))
})
test('independent M5 Product evidence: empty successful type and name key is not Product', () => {
  failure(verified([{ type: [], keys: ['name'] }]))
})
test('independent M5 Product evidence: unrelated keys @type+offers without Product type reject', () => {
  failure(verified([{ type: ['Offer'], keys: ['@type', 'offers'] }]))
})
test('independent M5 Product evidence: unrelated earlier parsed row before failed Product attempt rejects', () => {
  failure(verified([
    parsed('WebPage'), { type: [], keys: [], parseError: true },
  ]))
})
test('independent M5 Product evidence: direct Product type accepted', () => {
  assert.equal(valid(verified()).schemaOrgStatus, 'candidate_observation')
})
test('independent M5 Product evidence: lowercase product type accepted', () => {
  assert.equal(valid(verified([parsed('product')])).schemaOrgStatus, 'candidate_observation')
})
test('independent M5 Product evidence: upper/mixed-case Product type accepted', () => {
  assert.equal(valid(verified([parsed('PrOdUcT')])).schemaOrgStatus, 'candidate_observation')
})
test('independent M5 Product evidence: nested @graph key allows M1-verified observation', () => {
  assert.equal(valid(verified([{ type: ['WebPage'], keys: ['@graph'] }]))
    .schemaOrgStatus, 'candidate_observation')
})
test('independent M5 Product evidence: successful Product after unrelated page is admissible', () => {
  assert.equal(valid(verified([parsed('WebPage'), parsed('Product')]))
    .schemaOrgStatus, 'candidate_observation')
})
test('independent M5 Product evidence: ordinary WebPage under abstain stays valid P3', () => {
  const x = verified([parsed('WebPage')], { type: 'abstain' })
  assert.equal(review(x, structuredClone(x)).actions[0].priority, 'P3')
})
test('independent M5 Product evidence: parsed direct Product candidate is manual-only P2', () => {
  const x = verified([parsed('Product')],
    { type: 'observation', observation: { hidden: 'secret-product' } })
  assert.equal(review(x).actions[0].priority, 'P2')
})
test('independent M5 Product evidence: different genuine inline Product source is P1', () => {
  const validHtml = '<script type="application/ld+json">{"@type":"Product","offers":{}}</script>'
  const pageHtml = '<script type="application/ld+json">{"@type":"WebPage"}</script>'
  const fromHtml = (html, schema) => {
    const s = verified([], schema)
    s.html = inspectHtml(html)
    s.manifestSha256 = createHash('sha256').update(html).digest('hex')
    return s
  }
  const result = review(
    fromHtml(validHtml, { type: 'observation', observation: {} }),
    fromHtml(pageHtml, { type: 'abstain' }),
  )
  assert.equal(result.actions[0].status, 'shape_changed')
  assert.equal(result.actions[0].priority, 'P1')
})
test('independent M5 Product evidence: genuine same Product HTML remains private P3', () => {
  const x = verified()
  assert.equal(review(x, structuredClone(x)).actions[0].priority, 'P3')
})
test('independent M5 Product evidence: unavailable M1 capture still gets manual P1', () => {
  const x = verified([])
  x.success = false
  delete x.schemaOrgProduct
  assert.equal(review(x).actions[0].priority, 'P1')
})
test('independent M5 Product evidence: nested source observation payload is never exposed', () => {
  const x = verified([parsed('Product')], { type: 'observation', observation: {} })
  let calls = 0
  Object.defineProperty(x.schemaOrgProduct.observation, 'privatePrice', {
    get() { calls++; throw new Error('not permitted') },
  })
  assert.equal(captureShape(x).schemaOrgStatus, 'candidate_observation')
  assert.equal(calls, 0)
})
