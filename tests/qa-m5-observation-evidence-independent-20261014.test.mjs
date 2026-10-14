import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independent fully fictitious M1→M5 observation-provenance QA, exact same
// test bytes on original and corrected products. No network, prices or users.
const A = 'a'.repeat(64), B = 'b'.repeat(64)
const product = { type: ['Product'], keys: ['@type', 'offers'] }
const broken = { type: [], keys: [], parseError: true }
const source = (schema = { type: 'observation', observation: {} }, jsonLd = [product]) => ({
  id: 'synthetic-proof-source',
  supermarket: 'fictional', kind: 'product',
  success: true, integrity: 'verified', manifestSha256: A,
  schemaOrgProduct: schema,
  html: { hasNextData: false, jsonLd, applicationJsonScripts: [] },
})
const fail = input => {
  const before = structuredClone(input)
  assert.throws(() => captureShape(input), err => err instanceof Error &&
    err.message === 'Invalid inspected Schema.org parse result' &&
    !err.message.includes('synthetic-proof-source'))
  assert.deepEqual(input, before)
}
const allow = input => {
  const before = structuredClone(input)
  const s = captureShape(input)
  assert.equal(s.captureStatus, 'verified')
  assert.match(s.shapeSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(input, before)
  return s
}
const review = (now, old = null) => {
  const comparison = compareInspections(
    { sourceCount: 1, sources: [now] },
    old ? { sourceCount: 1, sources: [old] } : null,
  )
  const q = buildOfflineSelectorReviewQueue(comparison)
  for (const key of ['selectorVerified', 'rightsVerified', 'productionReady', 'm5Eligible']) {
    assert.equal(q[key], false)
  }
  assert.ok(q.actions.every(x =>
    x.selectorVerified === false && x.rightsVerified === false &&
    x.productionEnabled === false && /^[a-f0-9]{64}$/.test(x.sourceToken)))
  assert.doesNotMatch(JSON.stringify(q), /synthetic-proof-source|fictional|do-not-disclose/)
  return q
}
test('independent M5 observation: missing own observation payload cannot claim candidate', () => {
  fail(source({ type: 'observation' }))
})
test('independent M5 observation: null candidate payload fails closed', () => {
  fail(source({ type: 'observation', observation: null }))
})
test('independent M5 observation: array candidate payload fails closed', () => {
  fail(source({ type: 'observation', observation: [] }))
})
test('independent M5 observation: string candidate payload fails closed', () => {
  fail(source({ type: 'observation', observation: 'fake' }))
})
test('independent M5 observation: numeric candidate payload fails closed', () => {
  fail(source({ type: 'observation', observation: 1 }))
})
test('independent M5 observation: inherited candidate payload must not be accepted', () => {
  const x = source({ type: 'observation' })
  Object.setPrototypeOf(x.schemaOrgProduct, { observation: {} })
  assert.throws(() => captureShape(x), /Invalid inspected Schema.org parse result/)
})
test('independent M5 observation: candidate cannot exist without inspected JSON-LD', () => {
  fail(source({ type: 'observation', observation: {} }, []))
})
test('independent M5 observation: all JSON-LD parse errors forbid candidate', () => {
  fail(source({ type: 'observation', observation: {} }, [broken]))
})
test('independent M5 observation: 128 genuine parse-error entries cannot hide invented candidate', () => {
  fail(source({ type: 'observation', observation: {} },
    Array.from({ length: 128 }, () => ({ ...broken, type: [], keys: [] }))))
})
test('independent M5 observation: successful JSON-LD after failed block permits a candidate', () => {
  assert.equal(allow(source({ type: 'observation', observation: {} }, [broken, product]))
    .schemaOrgStatus, 'candidate_observation')
})
test('independent M5 observation: valid no-price observation remains private and manual-only P2', () => {
  const now = source({ type: 'observation', observation: { hidden: 'do-not-disclose' } })
  const out = review(now)
  assert.equal(out.actions[0].priority, 'P2')
})
test('independent M5 observation: candidate nested payload getters must never be invoked', () => {
  const x = source({ type: 'observation', observation: {} })
  let touched = 0
  Object.defineProperty(x.schemaOrgProduct.observation, 'privatePrice', {
    get() { touched++; throw new Error('never-inspect-private-price') },
  })
  assert.equal(captureShape(x).schemaOrgStatus, 'candidate_observation')
  assert.equal(touched, 0)
})
test('independent M5 observation: top-level observation getter cannot provide evidence', () => {
  const x = source({ type: 'observation' })
  let touched = 0
  Object.defineProperty(x.schemaOrgProduct, 'observation', {
    get() { touched++; throw new Error('private observer') },
  })
  assert.throws(() => captureShape(x), /^Error: Invalid inspected Schema.org parse result$/)
  assert.equal(touched, 0)
})
test('independent M5 observation: abstain cannot contain positive observation payload', () => {
  fail(source({ type: 'abstain', observation: {} }))
})
test('independent M5 observation: abstain cannot contain null observation payload', () => {
  fail(source({ type: 'abstain', observation: null }))
})
test('independent M5 observation: abstain may contain explicit undefined observation only', () => {
  assert.equal(allow(source({ type: 'abstain', observation: undefined }, []))
    .schemaOrgStatus, 'abstain')
})
test('independent M5 observation: real canonical abstention with malformed HTML is P3', () => {
  const html = '<script type="application/ld+json">{not-json</script>'
  const src = source({ type: 'abstain' })
  src.html = inspectHtml(html)
  src.manifestSha256 = createHash('sha256').update(html).digest('hex')
  assert.equal(src.html.jsonLd[0].parseError, true)
  assert.equal(review(src, structuredClone(src)).actions[0].priority, 'P3')
})
test('independent M5 observation: repaired fake Product HTML permits true P1', () => {
  const brokenHtml = '<script type="application/ld+json">{not-json</script>'
  const validHtml = '<script type="application/ld+json">{"@type":"Product","offers":{}}</script>'
  const fromHtml = (html, parser) => {
    const x = source(parser)
    x.html = inspectHtml(html)
    x.manifestSha256 = createHash('sha256').update(html).digest('hex')
    return x
  }
  const out = review(
    fromHtml(validHtml, { type: 'observation', observation: {} }),
    fromHtml(brokenHtml, { type: 'abstain' }),
  )
  assert.equal(out.actions[0].status, 'shape_changed')
  assert.equal(out.actions[0].priority, 'P1')
})
test('independent M5 observation: successful parsed Product and same HTML remains P3', () => {
  const x = source()
  assert.equal(review(x, structuredClone(x)).actions[0].priority, 'P3')
})
test('independent M5 observation: failed M1 capture without parser data remains P1', () => {
  const x = source()
  x.success = false
  delete x.schemaOrgProduct
  assert.equal(review(x).actions[0].priority, 'P1')
})
