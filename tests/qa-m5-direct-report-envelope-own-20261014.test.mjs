import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independently validate the nine M1 comparison report-envelope own-data fields.
// No genuine retailer, HTTP, person, price or rights data is used.
const markup = '<script type="application/ld+json">{"@type":"Product","offers":{}}</script>'
const invalidMarkup = '<script type="application/ld+json">{bad</script>'
const digest = data => createHash('sha256').update(data).digest('hex')
function capture(html = markup, decision = 'observation') {
  return {
    id: 'fake-confidential-source', supermarket: 'fictional', kind: 'product',
    success: true, integrity: 'verified', manifestSha256: digest(html),
    html: inspectHtml(html),
    schemaOrgProduct: decision === 'observation'
      ? { type: 'observation', observation: { price: 'PRIVATE-DO-NOT-READ' } }
      : { type: 'abstain' },
  }
}
function compare(now = [capture()], historical = null) {
  return compareInspections(
    { sourceCount: now.length, sources: now },
    historical === null ? null : { sourceCount: historical.length, sources: historical },
  )
}
function denied(report) {
  assert.throws(() => buildOfflineSelectorReviewQueue(report), e =>
    e instanceof Error && e.message === 'Invalid offline capture comparison report' &&
    !e.message.includes('PRIVATE-DO-NOT-READ') &&
    !e.message.includes('fake-confidential-source'))
}
function permitted(report, priority) {
  const q = buildOfflineSelectorReviewQueue(report)
  assert.equal(q.actions.length, 1)
  assert.equal(q.actions[0].priority, priority)
  assert.match(q.actions[0].sourceToken, /^[a-f\d]{64}$/)
  for (const f of ['productionReady','m5Eligible','rightsVerified','selectorVerified']) {
    assert.equal(q[f], false)
  }
  for (const f of ['productionEnabled','rightsVerified','selectorVerified']) {
    assert.equal(q.actions[0][f], false)
  }
  assert.doesNotMatch(JSON.stringify(q), /fake-confidential-source|PRIVATE-DO-NOT-READ|fictional/)
}
function getter(report, name, fakeValue = false) {
  const desc = Object.getOwnPropertyDescriptor(report, name)
  assert.ok(desc && Object.hasOwn(desc, 'value'))
  const original = desc.value
  let invoked = 0
  Object.defineProperty(report, name, {
    enumerable: true, configurable: true,
    get() { invoked++; if (fakeValue) return original; throw new Error('PRIVATE-DO-NOT-READ') },
  })
  denied(report)
  assert.equal(invoked, 0)
}
function inherited(name) {
  const report = compare()
  const value = report[name]
  delete report[name]
  Object.setPrototypeOf(report, { [name]: value })
  denied(report)
}
test('root control: real offline Product still remains manual P2', () => {
  permitted(compare(), 'P2')
})
test('root control: genuine unchanged historical Product remains manual P3', () => {
  const s = capture()
  permitted(compare([s], [structuredClone(s)]), 'P3')
})
test('root control: actually failed first M1 capture remains manual P1', () => {
  const s = capture()
  s.success = false
  delete s.schemaOrgProduct
  permitted(compare([s]), 'P1')
})
test('root control: malformed HTML abstain remains manual P2', () => {
  permitted(compare([capture(invalidMarkup, 'abstain')]), 'P2')
})
test('root RED: contractVersion accessor cannot be a legitimate report', () => {
  getter(compare(), 'contractVersion', true)
})
test('root RED: mode accessor may not execute', () => {
  getter(compare(), 'mode')
})
test('root RED: productionReady accessor cannot supply a false permission', () => {
  getter(compare(), 'productionReady', true)
})
test('root RED: m5Eligible accessor cannot supply a false release', () => {
  getter(compare(), 'm5Eligible', true)
})
test('root RED: reviewerActionRequired accessor cannot masquerade as a decision', () => {
  getter(compare(), 'reviewerActionRequired', true)
})
test('root RED: baselineProvided getter may not execute on historical P3', () => {
  const s = capture()
  getter(compare([s], [structuredClone(s)]), 'baselineProvided')
})
test('root RED: captureCount getter may not compute review population', () => {
  getter(compare(), 'captureCount')
})
test('root RED: driftCount getter may not compute review workload', () => {
  getter(compare(), 'driftCount')
})
test('root RED: changes getter may not forge reviewed actions', () => {
  getter(compare(), 'changes')
})
test('root RED: inherited contractVersion cannot create review report', () => {
  inherited('contractVersion')
})
test('root RED: inherited mode cannot create review report', () => {
  inherited('mode')
})
test('root RED: inherited captureCount cannot create review workload', () => {
  inherited('captureCount')
})
test('root RED: inherited changes cannot create public source tokens', () => {
  inherited('changes')
})
test('root RED: inherited getter on productionReady must never execute', () => {
  const report = compare()
  delete report.productionReady
  let invoked = 0
  Object.setPrototypeOf(report, Object.defineProperty({}, 'productionReady', {
    get() { invoked++; throw new Error('PRIVATE-DO-NOT-READ') },
  }))
  denied(report)
  assert.equal(invoked, 0)
})
