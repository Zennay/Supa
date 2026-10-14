import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// All sources entirely fictional; no retailer HTTP, user data or price access.
const productHtml = '<script type="application/ld+json">{"@type":"Product","offers":{}}</script>'
const brokenHtml = '<script type="application/ld+json">{broken</script>'
const hash = text => createHash('sha256').update(text).digest('hex')
function source(html = productHtml, kind = 'observation') {
  return {
    id: 'fictional-private-id', supermarket: 'fictional', kind: 'product',
    success: true, integrity: 'verified', manifestSha256: hash(html),
    html: inspectHtml(html),
    schemaOrgProduct: kind === 'observation'
      ? { type: 'observation', observation: { private: 'never-expose-this-value' } }
      : { type: 'abstain' },
  }
}
const comparison = (now = [source()], old = null) =>
  compareInspections(
    { sourceCount: now.length, sources: now },
    old === null ? null : { sourceCount: old.length, sources: old },
  )
function reject(report) {
  assert.throws(() => buildOfflineSelectorReviewQueue(report), err =>
    err instanceof Error && err.message === 'Invalid offline capture comparison report' &&
    !err.message.includes('fictional-private-id') &&
    !err.message.includes('never-expose-this-value'))
}
function valid(report, priority) {
  const result = buildOfflineSelectorReviewQueue(report)
  assert.equal(result.actions.length, 1)
  assert.equal(result.actions[0].priority, priority)
  assert.match(result.actions[0].sourceToken, /^[a-f0-9]{64}$/)
  for (const flag of ['rightsVerified','selectorVerified','productionReady','m5Eligible']) {
    assert.equal(result[flag], false)
  }
  for (const flag of ['rightsVerified','selectorVerified','productionEnabled']) {
    assert.equal(result.actions[0][flag], false)
  }
  assert.doesNotMatch(JSON.stringify(result), /fictional-private-id|never-expose-this-value|fictional/)
}
test('QA SHA control: authentic primitive Product P2 remains manual', () => {
  const r = comparison()
  assert.equal(typeof r.changes[0].current.snapshotSha256, 'string')
  assert.equal(typeof r.changes[0].current.shapeSha256, 'string')
  valid(r, 'P2')
})
test('QA SHA control: authentic unchanged P3 is permitted', () => {
  const x = source()
  valid(comparison([x], [structuredClone(x)]), 'P3')
})
test('QA SHA control: genuine unsuccessful M1 capture remains P1', () => {
  const x = source()
  x.success = false
  delete x.schemaOrgProduct
  valid(comparison([x]), 'P1')
})
test('QA SHA control: canonical malformed HTML abstain remains P2', () => {
  valid(comparison([source(brokenHtml, 'abstain')]), 'P2')
})
test('QA SHA control: malformed primitive SHA already fails', () => {
  const r = comparison()
  r.changes[0].current.snapshotSha256 = 'bad'
  reject(r)
})
test('QA SHA RED: boxed snapshot digest is not a primitive M1 SHA', () => {
  const r = comparison()
  r.changes[0].current.snapshotSha256 = new String(r.changes[0].current.snapshotSha256)
  reject(r)
})
test('QA SHA RED: boxed shape digest is not a primitive M1 SHA', () => {
  const r = comparison()
  r.changes[0].current.shapeSha256 = new String(r.changes[0].current.shapeSha256)
  reject(r)
})
test('QA SHA RED: array containing one 64-character string is not SHA text', () => {
  const r = comparison()
  r.changes[0].current.snapshotSha256 = [r.changes[0].current.snapshotSha256]
  reject(r)
})
test('QA SHA RED: custom snapshot toString cannot execute', () => {
  const r = comparison()
  const s = r.changes[0].current.snapshotSha256
  let calls = 0
  const v = { toString() { calls++; return s } }
  r.changes[0].current.snapshotSha256 = v
  reject(r)
  assert.equal(calls, 0)
  assert.equal(r.changes[0].current.snapshotSha256, v)
})
test('QA SHA RED: custom shape toString cannot execute', () => {
  const r = comparison()
  const s = r.changes[0].current.shapeSha256
  let calls = 0
  const v = { toString() { calls++; return s } }
  r.changes[0].current.shapeSha256 = v
  reject(r)
  assert.equal(calls, 0)
})
test('QA SHA RED: hostile Symbol.toPrimitive cannot disclose exception', () => {
  const r = comparison()
  let calls = 0
  r.changes[0].current.shapeSha256 = {
    [Symbol.toPrimitive]() { calls++; throw new Error('never-expose-this-value') },
  }
  reject(r)
  assert.equal(calls, 0)
})
test('QA SHA RED: removed historical capture with wrapped SHA must fail P1', () => {
  const r = comparison([], [source()])
  assert.equal(r.changes[0].status, 'removed')
  r.changes[0].baseline.snapshotSha256 = [r.changes[0].baseline.snapshotSha256]
  reject(r)
})
test('QA SHA RED: identical wrappers on two P3 snapshots are not SHA text', () => {
  const x = source()
  const r = comparison([x], [structuredClone(x)])
  assert.equal(r.changes[0].status, 'unchanged')
  const wrapped = new String(r.changes[0].current.snapshotSha256)
  r.changes[0].current.snapshotSha256 = wrapped
  r.changes[0].baseline.snapshotSha256 = wrapped
  reject(r)
})
test('QA SHA RED: historical shape wrapper must fail changed-HTML P1', () => {
  const r = comparison([source(brokenHtml, 'abstain')], [source()])
  assert.equal(r.changes[0].status, 'shape_changed')
  r.changes[0].baseline.shapeSha256 = [r.changes[0].baseline.shapeSha256]
  reject(r)
})
