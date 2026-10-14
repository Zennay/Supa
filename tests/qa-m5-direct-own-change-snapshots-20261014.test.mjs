import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independent, entirely fictitious offline M5 direct-report snapshot trust.
// Production M1 emits own plain data; no secret getters or inherited fields.
const html = '<script type="application/ld+json">{"@type":"Product","offers":{}}</script>'
const broken = '<script type="application/ld+json">{bad-json</script>'
const sha = value => createHash('sha256').update(value).digest('hex')
function source(markup = html, parser = 'observation') {
  return {
    id: 'private-fake-review-source', supermarket: 'fictional', kind: 'product',
    success: true, integrity: 'verified', manifestSha256: sha(markup),
    html: inspectHtml(markup),
    schemaOrgProduct: parser === 'observation'
      ? { type: 'observation', observation: { price: 'DO-NOT-DISCLOSE' } }
      : { type: 'abstain' },
  }
}
const compare = (now = [source()], before = null) =>
  compareInspections(
    { sourceCount: now.length, sources: now },
    before === null ? null : { sourceCount: before.length, sources: before },
  )
function rejects(report) {
  assert.throws(() => buildOfflineSelectorReviewQueue(report), err =>
    err instanceof Error && err.message === 'Invalid offline capture comparison report' &&
    !err.message.includes('private-fake-review-source') &&
    !err.message.includes('DO-NOT-DISCLOSE'))
}
function valid(report, priority) {
  const out = buildOfflineSelectorReviewQueue(report)
  assert.equal(out.actions.length, 1)
  assert.equal(out.actions[0].priority, priority)
  assert.match(out.actions[0].sourceToken, /^[a-f0-9]{64}$/)
  assert.doesNotMatch(JSON.stringify(out), /private-fake-review-source|DO-NOT-DISCLOSE|fictional/)
  for (const f of ['productionReady', 'rightsVerified', 'selectorVerified', 'm5Eligible']) {
    assert.equal(out[f], false)
  }
  for (const f of ['productionEnabled','rightsVerified','selectorVerified']) {
    assert.equal(out.actions[0][f], false)
  }
}
function poisoned(target, field, returningValue = false) {
  const descriptor = Object.getOwnPropertyDescriptor(target, field)
  assert.ok(descriptor && Object.hasOwn(descriptor, 'value'))
  let calls = 0
  const value = descriptor.value
  Object.defineProperty(target, field, {
    enumerable: true, configurable: true,
    get() { calls++; if (returningValue) return value; throw new Error('DO-NOT-DISCLOSE') },
  })
  return () => calls
}
function invalidField(side, field, returnsValue = false) {
  const sample = source()
  const report = compare([sample], [structuredClone(sample)])
  const target = report.changes[0][side]
  const calls = poisoned(target, field, returnsValue)
  rejects(report)
  assert.equal(calls(), 0)
}
function invalidChange(field, returnsValue = false) {
  const report = compare()
  const calls = poisoned(report.changes[0], field, returnsValue)
  rejects(report)
  assert.equal(calls(), 0)
}
test('direct snapshot control: authentic parsed Product stays private P2', () => {
  valid(compare(), 'P2')
})
test('direct snapshot control: unchanged real fake Product baseline stays P3', () => {
  const item = source()
  valid(compare([item], [structuredClone(item)]), 'P3')
})
test('direct snapshot control: legitimate failed first M1 remains P1', () => {
  const item = source()
  item.success = false
  delete item.schemaOrgProduct
  valid(compare([item]), 'P1')
})
test('direct snapshot control: genuine malformed JSON-LD abstention is P2', () => {
  valid(compare([source(broken, 'abstain')]), 'P2')
})
test('direct snapshot RED: snapshot id getter must never execute', () => {
  invalidField('current', 'id')
})
test('direct snapshot RED: supermarket origin getter must never execute', () => {
  invalidField('current', 'supermarket')
})
test('direct snapshot RED: kind getter must never execute', () => {
  invalidField('baseline', 'kind')
})
test('direct snapshot RED: captureStatus getter must never execute', () => {
  invalidField('baseline', 'captureStatus')
})
test('direct snapshot RED: schemaOrgStatus getter must never execute', () => {
  invalidField('current', 'schemaOrgStatus')
})
test('direct snapshot RED: hasNextData getter must never execute', () => {
  invalidField('baseline', 'hasNextData')
})
test('direct snapshot RED: jsonLdCount getter must never execute', () => {
  invalidField('current', 'jsonLdCount')
})
test('direct snapshot RED: jsonLdParseErrors getter must never execute', () => {
  invalidField('baseline', 'jsonLdParseErrors')
})
test('direct snapshot RED: plausible getter-provided schema decision is not valid P3', () => {
  invalidField('current', 'schemaOrgStatus', true)
})
test('direct snapshot RED: plausible getter-provided source id is not valid P3', () => {
  invalidField('baseline', 'id', true)
})
test('direct snapshot RED: change id getter must never execute', () => {
  invalidChange('id')
})
test('direct snapshot RED: change status getter must never execute', () => {
  invalidChange('status')
})
test('direct snapshot RED: change current getter cannot be used for P2', () => {
  invalidChange('current')
})
test('direct snapshot RED: change baseline getter cannot be used for P2', () => {
  invalidChange('baseline')
})
test('direct snapshot RED: plausible getter-provided change status is still forbidden', () => {
  invalidChange('status', true)
})
test('direct snapshot RED: array slot getter cannot construct trusted action', () => {
  const report = compare()
  const calls = poisoned(report.changes, 0)
  rejects(report)
  assert.equal(calls(), 0)
})
test('direct snapshot RED: inherited schema status cannot provide positive Product', () => {
  const report = compare()
  const value = report.changes[0].current.schemaOrgStatus
  delete report.changes[0].current.schemaOrgStatus
  Object.setPrototypeOf(report.changes[0].current, { schemaOrgStatus: value })
  rejects(report)
})
test('direct snapshot RED: inherited change status cannot provide baseline priority', () => {
  const report = compare()
  const value = report.changes[0].status
  delete report.changes[0].status
  Object.setPrototypeOf(report.changes[0], { status: value })
  rejects(report)
})
test('direct snapshot RED: historical P1 source metadata getter cannot leak exception', () => {
  const report = compare([], [source()])
  assert.equal(report.changes[0].status, 'removed')
  const calls = poisoned(report.changes[0].baseline, 'kind')
  rejects(report)
  assert.equal(calls(), 0)
})
