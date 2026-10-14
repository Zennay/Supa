import assert from 'node:assert/strict'
import test from 'node:test'

import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Invented data only. Never request a retailer, user, or genuine price page.
const SHA = 'a'.repeat(64)
const cohort = (sources) => ({ sourceCount: sources.length, sources })
const product = (id = 'fictional-item') => ({
  id, supermarket: 'plus', kind: 'product', success: true,
  integrity: 'verified', manifestSha256: SHA,
  html: {
    hasNextData: false,
    jsonLd: [{ type: ['Product'], keys: ['@type', 'name'] }],
    applicationJsonScripts: [{ id: null, bytes: 0 }],
  },
  schemaOrgProduct: { type: 'observation', observation: { name: 'PRIVATE-SYNTHETIC' } },
})
const failed = () => ({
  id: 'fictional-failure', supermarket: 'plus', kind: 'product', success: false,
})
function trapped(value) {
  let calls = 0
  const guard = () => { calls++; throw Error('PRIVATE-PROXY-TRAP') }
  const proxy = new Proxy(value, {
    get: guard, getOwnPropertyDescriptor: guard, ownKeys: guard, has: guard,
  })
  return { proxy, get calls() { return calls } }
}
function revoked(value) {
  const { proxy, revoke } = Proxy.revocable(value, {})
  revoke()
  return proxy
}
function rejected(fn, message, guard = null) {
  assert.throws(fn, new RegExp('^Error: ' + message + '$'))
  if (guard) assert.equal(guard.calls, 0, 'no untrusted Proxy trap may be evaluated')
}
function status(result, expected) {
  const queue = buildOfflineSelectorReviewQueue(result)
  assert.equal(queue.actions[0].priority, expected)
  assert.equal(queue.rightsVerified, false)
  assert.equal(queue.selectorVerified, false)
  assert.equal(queue.productionReady, false)
  assert.equal(queue.m5Eligible, false)
  assert.doesNotMatch(JSON.stringify(queue), /PRIVATE-SYNTHETIC|PRIVATE-PROXY-TRAP/)
}
const baseline = () => cohort([product()])

test('current cohort Proxy fails before root descriptor trap', () => {
  const v = trapped(cohort([product()]))
  rejected(() => compareInspections(v.proxy), 'Invalid or unbounded current inspection', v)
})
test('historical cohort Proxy fails before root descriptor trap', () => {
  const v = trapped(cohort([product()]))
  rejected(() => compareInspections(cohort([product()]), v.proxy),
    'Invalid or unbounded baseline inspection', v)
})
test('revoked current root Proxy receives opaque current error', () => {
  rejected(() => compareInspections(revoked(cohort([product()]))),
    'Invalid or unbounded current inspection')
})
test('revoked historical root Proxy receives opaque baseline error', () => {
  rejected(() => compareInspections(cohort([product()]), revoked(cohort([product()]))),
    'Invalid or unbounded baseline inspection')
})
test('current sources array Proxy fails before length/getOwnPropertyDescriptor', () => {
  const v = trapped([product()])
  rejected(() => compareInspections({ sourceCount: 1, sources: v.proxy }),
    'Invalid or unbounded current inspection', v)
})
test('baseline sources array Proxy fails before length/getOwnPropertyDescriptor', () => {
  const v = trapped([product()])
  rejected(() => compareInspections(cohort([product()]), { sourceCount: 1, sources: v.proxy }),
    'Invalid or unbounded baseline inspection', v)
})
test('revoked current source array fails without private TypeError', () => {
  rejected(() => compareInspections({ sourceCount: 1, sources: revoked([product()]) }),
    'Invalid or unbounded current inspection')
})
test('revoked historical source array fails without private TypeError', () => {
  rejected(() => compareInspections(cohort([product()]), { sourceCount: 1, sources: revoked([product()]) }),
    'Invalid or unbounded baseline inspection')
})
test('source row Proxy fails before getter/descriptor traps for verified capture', () => {
  const v = trapped(product())
  rejected(() => captureShape(v.proxy), 'Invalid inspected source', v)
})
test('source row Proxy fails for unavailable capture too', () => {
  const v = trapped(failed())
  rejected(() => compareInspections(cohort([v.proxy])), 'Invalid inspected source', v)
})
test('revoked source row Proxy fails without leaking runtime TypeError', () => {
  rejected(() => captureShape(revoked(product())), 'Invalid inspected source')
})
test('historical source row Proxy fails with safe source error', () => {
  const v = trapped(product())
  rejected(() => compareInspections(cohort([product()]), cohort([v.proxy])),
    'Invalid inspected source', v)
})
test('HTML shape root Proxy fails without descriptor introspection', () => {
  const v = trapped(product().html)
  const p = product()
  p.html = v.proxy
  rejected(() => captureShape(p), 'Invalid or unbounded inspected HTML shape', v)
})
test('revoked HTML shape Proxy fails with generic HTML error', () => {
  const p = product()
  p.html = revoked(p.html)
  rejected(() => captureShape(p), 'Invalid or unbounded inspected HTML shape')
})
test('JSON-LD array Proxy fails before reading length', () => {
  const p = product(), v = trapped(p.html.jsonLd)
  p.html.jsonLd = v.proxy
  rejected(() => captureShape(p), 'Invalid or unbounded inspected HTML shape', v)
})
test('application JSON array Proxy fails before reading length', () => {
  const p = product(), v = trapped(p.html.applicationJsonScripts)
  p.html.applicationJsonScripts = v.proxy
  rejected(() => captureShape(p), 'Invalid or unbounded inspected HTML shape', v)
})
test('JSON-LD metadata row Proxy fails before descriptor lookup', () => {
  const p = product(), v = trapped(p.html.jsonLd[0])
  p.html.jsonLd[0] = v.proxy
  rejected(() => captureShape(p), 'Invalid or unbounded inspected HTML shape', v)
})
test('JSON-LD type array Proxy fails before length or numeric slots', () => {
  const p = product(), v = trapped(p.html.jsonLd[0].type)
  p.html.jsonLd[0].type = v.proxy
  rejected(() => captureShape(p), 'Invalid or unbounded inspected HTML shape', v)
})
test('JSON-LD key array Proxy fails before length or numeric slots', () => {
  const p = product(), v = trapped(p.html.jsonLd[0].keys)
  p.html.jsonLd[0].keys = v.proxy
  rejected(() => captureShape(p), 'Invalid or unbounded inspected HTML shape', v)
})
test('application JSON descriptor row Proxy fails before getOwnPropertyDescriptor', () => {
  const p = product(), v = trapped(p.html.applicationJsonScripts[0])
  p.html.applicationJsonScripts[0] = v.proxy
  rejected(() => captureShape(p), 'Invalid or unbounded inspected HTML shape', v)
})
test('Schema.org decision record Proxy cannot invoke descriptor traps', () => {
  const p = product(), v = trapped(p.schemaOrgProduct)
  p.schemaOrgProduct = v.proxy
  rejected(() => captureShape(p), 'Invalid inspected Schema.org parse result', v)
})
test('Schema.org observation payload Proxy is not canonical evidence', () => {
  const p = product(), v = trapped(p.schemaOrgProduct.observation)
  p.schemaOrgProduct.observation = v.proxy
  rejected(() => captureShape(p), 'Invalid inspected Schema.org parse result', v)
})
test('revoked Schema.org decision Proxy fails with generic parser error', () => {
  const p = product()
  p.schemaOrgProduct = revoked(p.schemaOrgProduct)
  rejected(() => captureShape(p), 'Invalid inspected Schema.org parse result')
})
test('revoked JSON-LD row Proxy fails with generic HTML error', () => {
  const p = product()
  p.html.jsonLd[0] = revoked(p.html.jsonLd[0])
  rejected(() => captureShape(p), 'Invalid or unbounded inspected HTML shape')
})
test('revoked nested JSON-LD terms array fails with generic HTML error', () => {
  const p = product()
  p.html.jsonLd[0].keys = revoked(p.html.jsonLd[0].keys)
  rejected(() => captureShape(p), 'Invalid or unbounded inspected HTML shape')
})
test('normal own-data source retains canonical candidate observation status', () => {
  const shape = captureShape(product())
  assert.equal(shape.schemaOrgStatus, 'candidate_observation')
  assert.match(shape.shapeSha256, /^[a-f0-9]{64}$/)
})
test('separately allocated clean Product cohorts retain manual P3', () => {
  status(compareInspections(cohort([product()]), baseline()), 'P3')
})
test('unavailable capture remains manual P1', () => {
  status(compareInspections(cohort([failed()])), 'P1')
})
test('one current ordinary Product without history remains manual P2', () => {
  status(compareInspections(cohort([product()])), 'P2')
})
test('removed historical Product stays manual P1', () => {
  status(compareInspections(cohort([]), baseline()), 'P1')
})
test('shared same source object still refused as fake historical independent data', () => {
  const s = product()
  rejected(() => compareInspections(cohort([s]), cohort([s])),
    'Invalid or unbounded baseline inspection')
})
test('canonical entirely empty cohorts retain supplied baseline status', () => {
  const r = compareInspections(cohort([]), cohort([]))
  assert.equal(r.baselineProvided, true)
  assert.equal(r.changes.length, 0)
})
