import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Independent direct-queue SHA descriptor acceptance, entirely synthetic and offline.
// The production M1 comparer emits own data-property primitive SHA values.
const markup = '<script type="application/ld+json">{"@type":"Product","offers":{}}</script>'
const malformed = '<script type="application/ld+json">{not-json</script>'
const sha = value => createHash('sha256').update(value).digest('hex')
function source(html = markup, decision = 'observation') {
  return {
    id: 'private-fake-source', supermarket: 'fictional', kind: 'product',
    success: true, integrity: 'verified', manifestSha256: sha(html),
    html: inspectHtml(html),
    schemaOrgProduct: decision === 'observation'
      ? { type: 'observation', observation: { fakePrice: 'NEVER_SHOW_THIS' } }
      : { type: 'abstain' },
  }
}
function compare(now = [source()], old = null) {
  return compareInspections(
    { sourceCount: now.length, sources: now },
    old === null ? null : { sourceCount: old.length, sources: old },
  )
}
function reject(report) {
  assert.throws(() => buildOfflineSelectorReviewQueue(report), error =>
    error instanceof Error &&
    error.message === 'Invalid offline capture comparison report' &&
    !error.message.includes('NEVER_SHOW_THIS') &&
    !error.message.includes('private-fake-source'))
}
function accepted(report, priority) {
  const result = buildOfflineSelectorReviewQueue(report)
  assert.equal(result.actions.length, 1)
  assert.equal(result.actions[0].priority, priority)
  assert.match(result.actions[0].sourceToken, /^[a-f0-9]{64}$/)
  for (const field of ['selectorVerified', 'rightsVerified', 'productionReady', 'm5Eligible']) {
    assert.equal(result[field], false)
  }
  for (const field of ['selectorVerified', 'rightsVerified', 'productionEnabled']) {
    assert.equal(result.actions[0][field], false)
  }
  assert.doesNotMatch(JSON.stringify(result), /private-fake-source|NEVER_SHOW_THIS|fictional/)
}
function accessor(snapshot, field, fn) {
  Object.defineProperty(snapshot, field, {
    enumerable: true, configurable: true, get: fn,
  })
}
test('own-SHA control: genuine parsed Product is manual P2 with own primitive hashes', () => {
  const report = compare()
  for (const field of ['snapshotSha256', 'shapeSha256']) {
    const desc = Object.getOwnPropertyDescriptor(report.changes[0].current, field)
    assert.equal(typeof desc.value, 'string')
    assert.match(desc.value, /^[a-f0-9]{64}$/)
  }
  accepted(report, 'P2')
})
test('own-SHA control: authentic identical historical Product remains P3', () => {
  const original = source()
  accepted(compare([original], [structuredClone(original)]), 'P3')
})
test('own-SHA control: genuine malformed JSON-LD abstain stays private P2', () => {
  accepted(compare([source(malformed, 'abstain')]), 'P2')
})
test('own-SHA control: a genuinely failed M1 source remains manual P1', () => {
  const item = source()
  item.success = false
  delete item.schemaOrgProduct
  accepted(compare([item]), 'P1')
})
test('own-SHA control: missing own digest is already refused', () => {
  const report = compare()
  delete report.changes[0].current.shapeSha256
  reject(report)
})
test('own-SHA RED: current snapshot digest getter may not execute', () => {
  const report = compare()
  let calls = 0
  accessor(report.changes[0].current, 'snapshotSha256',
    () => { calls++; throw new Error('NEVER_SHOW_THIS') })
  reject(report)
  assert.equal(calls, 0)
})
test('own-SHA RED: current shape digest getter may not execute', () => {
  const report = compare()
  let calls = 0
  accessor(report.changes[0].current, 'shapeSha256',
    () => { calls++; throw new Error('NEVER_SHOW_THIS') })
  reject(report)
  assert.equal(calls, 0)
})
test('own-SHA RED: current valid-looking digest getter must not be accepted', () => {
  const report = compare()
  const val = report.changes[0].current.snapshotSha256
  let calls = 0
  accessor(report.changes[0].current, 'snapshotSha256', () => { calls++; return val })
  reject(report)
  assert.equal(calls, 0)
})
test('own-SHA RED: current valid-looking shape getter must not be accepted', () => {
  const report = compare()
  const val = report.changes[0].current.shapeSha256
  let calls = 0
  accessor(report.changes[0].current, 'shapeSha256', () => { calls++; return val })
  reject(report)
  assert.equal(calls, 0)
})
test('own-SHA RED: inherited primitive snapshot digest cannot justify P2', () => {
  const report = compare()
  const s = report.changes[0].current
  const val = s.snapshotSha256
  delete s.snapshotSha256
  Object.setPrototypeOf(s, { snapshotSha256: val })
  reject(report)
})
test('own-SHA RED: inherited primitive shape digest cannot justify P2', () => {
  const report = compare()
  const s = report.changes[0].current
  const val = s.shapeSha256
  delete s.shapeSha256
  Object.setPrototypeOf(s, { shapeSha256: val })
  reject(report)
})
test('own-SHA RED: inherited snapshot getter cannot execute', () => {
  const report = compare()
  const s = report.changes[0].current
  delete s.snapshotSha256
  let calls = 0
  Object.setPrototypeOf(s, Object.defineProperty({}, 'snapshotSha256', {
    get() { calls++; throw new Error('NEVER_SHOW_THIS') },
  }))
  reject(report)
  assert.equal(calls, 0)
})
test('own-SHA RED: historical removed-source snapshot getter returning hash fails P1', () => {
  const report = compare([], [source()])
  assert.equal(report.changes[0].status, 'removed')
  const historical = report.changes[0].baseline
  const val = historical.snapshotSha256
  let calls = 0
  accessor(historical, 'snapshotSha256', () => { calls++; return val })
  reject(report)
  assert.equal(calls, 0)
})
test('own-SHA RED: historical removed-source shape getter must not leak private text', () => {
  const report = compare([], [source()])
  const historical = report.changes[0].baseline
  let calls = 0
  accessor(historical, 'shapeSha256',
    () => { calls++; throw new Error('NEVER_SHOW_THIS') })
  reject(report)
  assert.equal(calls, 0)
})
test('own-SHA RED: two equal getter digests cannot masquerade as unchanged P3', () => {
  const value = source()
  const report = compare([value], [structuredClone(value)])
  assert.equal(report.changes[0].status, 'unchanged')
  let calls = 0
  for (const side of ['current', 'baseline']) {
    const snapshot = report.changes[0][side]
    const digest = snapshot.snapshotSha256
    accessor(snapshot, 'snapshotSha256', () => { calls++; return digest })
  }
  reject(report)
  assert.equal(calls, 0)
})
test('own-SHA RED: historical P1 shape change cannot use getter-provided shape', () => {
  const report = compare([source()], [source(malformed, 'abstain')])
  assert.equal(report.changes[0].status, 'shape_changed')
  const historical = report.changes[0].baseline
  const val = historical.shapeSha256
  let calls = 0
  accessor(historical, 'shapeSha256', () => { calls++; return val })
  reject(report)
  assert.equal(calls, 0)
})
