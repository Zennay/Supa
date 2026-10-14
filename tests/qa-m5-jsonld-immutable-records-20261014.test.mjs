import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// QA 2/2: immutable own JSON-LD descriptors, no network or real customers.
const direct = { type: ['Product'], keys: ['@type', 'offers'] }
const parseFailed = { type: [], keys: [], parseError: true }
function sample(jsonLd = [direct], decision = 'observation') {
  return {
    id: 'synthetic-secret-source', supermarket: 'fictional', kind: 'product',
    success: true, integrity: 'verified', manifestSha256: 'a'.repeat(64),
    html: { hasNextData: false, jsonLd, applicationJsonScripts: [] },
    schemaOrgProduct: decision === 'observation'
      ? { type: 'observation', observation: { internal: 'DO-NOT-PRINT' } }
      : { type: 'abstain' },
  }
}
function invalid(source) {
  assert.throws(() => captureShape(source), err =>
    err instanceof Error && err.message === 'Invalid or unbounded inspected HTML shape' &&
    !err.message.includes('DO-NOT-PRINT') && !err.message.includes('synthetic-secret-source'))
}
function mustNotRead(change) {
  let called = 0
  const getter = () => { called++; throw new Error('DO-NOT-PRINT') }
  const src = change(getter)
  invalid(src)
  assert.equal(called, 0)
}
function review(source, expected) {
  const cmp = compareInspections({ sourceCount: 1, sources: [source] })
  const q = buildOfflineSelectorReviewQueue(cmp)
  assert.equal(q.actions.length, 1)
  assert.equal(q.actions[0].priority, expected)
  assert.match(q.actions[0].sourceToken, /^[a-f0-9]{64}$/)
  assert.doesNotMatch(JSON.stringify(q), /synthetic-secret-source|DO-NOT-PRINT|fictional/)
  for (const flag of ['selectorVerified','rightsVerified','productionReady','m5Eligible']) {
    assert.equal(q[flag], false)
  }
  for (const flag of ['selectorVerified','rightsVerified','productionEnabled']) {
    assert.equal(q.actions[0][flag], false)
  }
}
test('M5 descriptor control: ordinary own parsed Product remains a candidate', () => {
  const x = sample()
  const s = captureShape(x)
  assert.equal(s.schemaOrgStatus, 'candidate_observation')
  assert.match(s.shapeSha256, /^[a-f0-9]{64}$/)
  review(x, 'P2')
})
test('M5 descriptor control: real fake HTML inspector keeps valid Product metadata', () => {
  const html = '<script type="application/ld+json">{"@type":"Product","offers":{}}</script>'
  const x = sample(inspectHtml(html).jsonLd)
  x.manifestSha256 = createHash('sha256').update(html).digest('hex')
  review(x, 'P2')
})
test('M5 descriptor control: honest parseError-only abstain stays reviewable', () => {
  const x = sample([parseFailed], 'abstain')
  assert.equal(captureShape(x).schemaOrgStatus, 'abstain')
  review(x, 'P2')
})
test('M5 descriptor control: canonical failed M1 capture stays unavailable', () => {
  const x = sample()
  x.success = false
  delete x.schemaOrgProduct
  review(x, 'P1')
})
test('M5 descriptor control: invalid array length is already rejected', () => {
  invalid(sample([{ type: Array.from({ length: 257 }, () => 'Product'), keys: [] }]))
})
test('M5 descriptor RED: type getter cannot execute', () => {
  mustNotRead(get => {
    const row = { keys: ['@type'] }
    Object.defineProperty(row, 'type', { get, enumerable: true })
    return sample([row])
  })
})
test('M5 descriptor RED: keys getter cannot execute', () => {
  mustNotRead(get => {
    const row = { type: ['Product'] }
    Object.defineProperty(row, 'keys', { get, enumerable: true })
    return sample([row])
  })
})
test('M5 descriptor RED: parseError getter cannot execute', () => {
  mustNotRead(get => {
    const row = { type: [], keys: [] }
    Object.defineProperty(row, 'parseError', { get, enumerable: true })
    return sample([row], 'abstain')
  })
})
test('M5 descriptor RED: inherited type data cannot impersonate M1 source', () => {
  const row = Object.assign(Object.create({ type: ['Product'] }), { keys: ['@type'] })
  invalid(sample([row]))
})
test('M5 descriptor RED: inherited keys data cannot impersonate M1 source', () => {
  const row = Object.assign(Object.create({ keys: ['@type'] }), { type: ['Product'] })
  invalid(sample([row]))
})
test('M5 descriptor RED: inherited parseError cannot impersonate an M1 failure', () => {
  const row = Object.assign(Object.create({ parseError: true }), { type: [], keys: [] })
  invalid(sample([row], 'abstain'))
})
test('M5 descriptor RED: type-array numeric getter must never execute', () => {
  mustNotRead(get => {
    const type = ['Product']
    Object.defineProperty(type, '0', { get, enumerable: true, configurable: true })
    return sample([{ type, keys: ['@type'] }])
  })
})
test('M5 descriptor RED: keys-array numeric getter must never execute', () => {
  mustNotRead(get => {
    const keys = ['@type']
    Object.defineProperty(keys, '0', { get, enumerable: true, configurable: true })
    return sample([{ type: ['Product'], keys }])
  })
})
test('M5 descriptor RED: JSON-LD list numeric getter must never execute', () => {
  mustNotRead(get => {
    const rows = [direct]
    Object.defineProperty(rows, '0', { get, enumerable: true, configurable: true })
    return sample(rows)
  })
})
