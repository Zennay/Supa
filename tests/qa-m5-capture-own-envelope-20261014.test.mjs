import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independent in-memory M1→M5 capture provenance tests. Fictional data only.
const html = '<script type="application/ld+json">{"@type":"Product","offers":{}}</script>'
const malformed = '<script type="application/ld+json">{no-json</script>'
const sha = value => createHash('sha256').update(value).digest('hex')
function capture(markup = html, decision = 'observation') {
  return {
    id: 'private-fake-retailer', supermarket: 'fictional', kind: 'product',
    success: true, integrity: 'verified', manifestSha256: sha(markup),
    html: inspectHtml(markup),
    schemaOrgProduct: decision === 'observation'
      ? { type: 'observation', observation: { privatePrice: 'NEVER-EXPOSE-PRICE' } }
      : { type: 'abstain' },
  }
}
function failed() {
  return {
    id: 'private-fake-retailer', supermarket: 'fictional', kind: 'product',
    success: false,
  }
}
function reject(value, message) {
  assert.throws(() => captureShape(value), error =>
    error instanceof Error && error.message === message &&
    !error.message.includes('NEVER-EXPOSE-PRICE') &&
    !error.message.includes('private-fake-retailer'))
}
function preventGetter(value, key, message, returnsValue = false) {
  const own = Object.getOwnPropertyDescriptor(value, key)
  assert.ok(own && Object.hasOwn(own, 'value'))
  const original = own.value
  let called = 0
  Object.defineProperty(value, key, {
    configurable: true, enumerable: true,
    get() {
      called++
      if (returnsValue) return original
      throw new Error('NEVER-EXPOSE-PRICE')
    },
  })
  reject(value, message)
  assert.equal(called, 0)
}
function inherited(key, message, source = capture()) {
  const value = source[key]
  delete source[key]
  Object.setPrototypeOf(source, { [key]: value })
  reject(source, message)
}
function review(now, old, priority) {
  const report = compareInspections(
    { sourceCount: 1, sources: [now] },
    old ? { sourceCount: 1, sources: [old] } : null,
  )
  const q = buildOfflineSelectorReviewQueue(report)
  assert.equal(q.actions.length, 1)
  assert.equal(q.actions[0].priority, priority)
  assert.match(q.actions[0].sourceToken, /^[a-f0-9]{64}$/)
  for (const f of ['productionReady','m5Eligible','rightsVerified','selectorVerified']) {
    assert.equal(q[f], false)
  }
  for (const f of ['productionEnabled','rightsVerified','selectorVerified']) {
    assert.equal(q.actions[0][f], false)
  }
  assert.doesNotMatch(JSON.stringify(q), /private-fake-retailer|NEVER-EXPOSE-PRICE|fictional/)
}
test('source-envelope control: real fake parsed Product is manual P2', () => {
  review(capture(), null, 'P2')
})
test('source-envelope control: unchanged real fake Product is manual P3', () => {
  const s = capture()
  review(s, structuredClone(s), 'P3')
})
test('source-envelope control: genuine malformed JSON-LD abstain remains P2', () => {
  review(capture(malformed,'abstain'), null, 'P2')
})
test('source-envelope control: genuine failed capture remains manual P1', () => {
  review(failed(), null, 'P1')
})
test('source-envelope RED: id getter must never execute', () => {
  preventGetter(capture(), 'id', 'Invalid inspected source')
})
test('source-envelope RED: supermarket getter must never execute', () => {
  preventGetter(capture(), 'supermarket', 'Invalid inspected source origin')
})
test('source-envelope RED: kind getter must never execute', () => {
  preventGetter(capture(), 'kind', 'Invalid inspected source origin')
})
test('source-envelope RED: success getter must never execute', () => {
  preventGetter(capture(), 'success', 'Invalid inspected capture success')
})
test('source-envelope RED: integrity getter must never execute', () => {
  preventGetter(capture(), 'integrity', 'Snapshot integrity verification required')
})
test('source-envelope RED: manifest SHA getter must never execute', () => {
  preventGetter(capture(), 'manifestSha256', 'Snapshot integrity verification required')
})
test('source-envelope RED: getter-supplied valid-looking id cannot pass provenance', () => {
  preventGetter(capture(), 'id', 'Invalid inspected source', true)
})
test('source-envelope RED: getter-supplied valid-looking SHA cannot pass provenance', () => {
  preventGetter(capture(), 'manifestSha256', 'Snapshot integrity verification required', true)
})
test('source-envelope RED: inherited source id cannot justify observed Product', () => {
  inherited('id', 'Invalid inspected source')
})
test('source-envelope RED: inherited source origin cannot justify observed Product', () => {
  inherited('supermarket', 'Invalid inspected source origin')
})
test('source-envelope RED: inherited capture kind cannot justify observed Product', () => {
  inherited('kind', 'Invalid inspected source origin')
})
test('source-envelope RED: inherited success on unavailable capture must fail', () => {
  inherited('success', 'Invalid inspected capture success', failed())
})
test('source-envelope RED: inherited integrity cannot justify verified Product', () => {
  inherited('integrity', 'Snapshot integrity verification required')
})
test('source-envelope RED: inherited manifest hash cannot justify verified Product', () => {
  inherited('manifestSha256', 'Snapshot integrity verification required')
})
test('source-envelope RED: boxed SHA is not a canonical M1 primitive hash', () => {
  const x = capture()
  x.manifestSha256 = new String(x.manifestSha256)
  reject(x, 'Snapshot integrity verification required')
})
test('source-envelope RED: one-element SHA array is not a primitive hash', () => {
  const x = capture()
  x.manifestSha256 = [x.manifestSha256]
  reject(x, 'Snapshot integrity verification required')
})
test('source-envelope RED: custom ToString hash must not execute or be admitted', () => {
  const x = capture()
  const hash = x.manifestSha256
  let invoked = 0
  x.manifestSha256 = { toString() { invoked++; return hash } }
  reject(x, 'Snapshot integrity verification required')
  assert.equal(invoked, 0)
})
test('source-envelope RED: Symbol.toPrimitive must not disclose private error', () => {
  const x = capture()
  let invoked = 0
  x.manifestSha256 = {
    [Symbol.toPrimitive]() { invoked++; throw new Error('NEVER-EXPOSE-PRICE') },
  }
  reject(x, 'Snapshot integrity verification required')
  assert.equal(invoked, 0)
})
