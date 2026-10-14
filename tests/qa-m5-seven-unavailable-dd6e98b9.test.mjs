import assert from 'node:assert/strict'
import test from 'node:test'

import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// Pure synthetic local inspection objects. No real source, participant, price,
// network/proxy, retailer permission, selector approval or M5 eligibility.
const A = 'a'.repeat(64)

function source(id, available = true) {
  return {
    id, supermarket: 'fictional-market', kind: 'product',
    success: available,
    ...(available ? {
      integrity: 'verified', manifestSha256: A,
      html: { hasNextData: false, jsonLd: [], applicationJsonScripts: [] },
      schemaOrgProduct: { type: 'abstain' },
    } : {}),
  }
}

function inspection(sources) {
  return { sourceCount: sources.length, sources }
}

function inspect(current, baseline = null) {
  const left = inspection(current)
  const right = baseline === null ? null : inspection(baseline)
  const before = structuredClone([left, right])
  const report = compareInspections(left, right)
  assert.deepEqual([left, right], before, 'offline inspections must remain immutable')
  assert.equal(report.productionReady, false)
  assert.equal(report.m5Eligible, false)
  const queue = buildOfflineSelectorReviewQueue(report)
  assert.equal(queue.productionReady, false)
  assert.equal(queue.m5Eligible, false)
  assert.equal(queue.rightsVerified, false)
  assert.equal(queue.selectorVerified, false)
  assert.equal(queue.reviewerActionRequired, true)
  assert.equal(queue.actions.every(a => a.rightsVerified === false &&
    a.selectorVerified === false && a.productionEnabled === false &&
    /^[a-f0-9]{64}$/.test(a.sourceToken)), true)
  assert.doesNotMatch(JSON.stringify(queue), /fictional-market|sample-/)
  return { report, queue }
}

test('M5 QA positive: first verified capture with no baseline is P2 human baseline preparation', () => {
  const { report, queue } = inspect([source('sample-first-valid')])
  assert.equal(report.baselineProvided, false)
  assert.equal(report.changes[0].status, 'baseline_missing')
  assert.equal(report.captureCount, 1)
  assert.equal(queue.actions[0].priority, 'P2')
  assert.equal(queue.actions[0].action, 'establish_approved_baseline')
})

test('M5 QA positive: new verified source alongside existing baseline is P2 human source review', () => {
  const { report, queue } = inspect(
    [source('sample-stable'), source('sample-new-valid')],
    [source('sample-stable')],
  )
  assert.equal(report.baselineProvided, true)
  assert.equal(report.changes.find(c => c.id === 'sample-new-valid').status, 'added')
  assert.deepEqual(queue.actions.map(a => a.priority), ['P2', 'P3'])
})

test('M5 QA positive: unavailable current capture for a known baseline source remains P1', () => {
  const { report, queue } = inspect(
    [source('sample-known-unavailable', false)],
    [source('sample-known-unavailable')],
  )
  assert.equal(report.changes[0].status, 'unavailable')
  assert.equal(report.driftCount, 1)
  assert.deepEqual(queue.actions.map(a => a.priority), ['P1'])
  assert.equal(queue.actions[0].action, 'recapture_or_investigate_failure')
})

test('M5 QA RED: first unavailable source without baseline must have P1 human priority', () => {
  const { report, queue } = inspect([source('sample-first-unavailable', false)])
  assert.equal(report.captureCount, 1)
  assert.equal(queue.actions[0].priority, 'P1')
})

test('M5 QA RED: failed first capture with no baseline contributes to drift warning count', () => {
  const { report } = inspect([source('sample-missing-baseline', false)])
  assert.equal(report.captureCount, 1)
  assert.equal(report.driftCount, 1, 'a failed capture cannot be silently zero-drift')
})

test('M5 QA RED: newly discovered but unavailable source cannot be P2 added review', () => {
  const { report, queue } = inspect(
    [source('sample-existing'), source('sample-new-unavailable', false)],
    [source('sample-existing')],
  )
  assert.equal(report.captureCount, 2)
  assert.equal(queue.actions.find(a => a.priority === 'P1')?.priority, 'P1',
    'unavailable candidate must receive P1 human investigation')
})

test('M5 QA RED: mixed new healthy and failed sources must sort failed P1 before valid P2', () => {
  const { report, queue } = inspect(
    [source('sample-existing'), source('sample-new-valid'), source('sample-new-unavailable', false)],
    [source('sample-existing')],
  )
  assert.equal(report.captureCount, 3)
  assert.deepEqual(queue.actions.map(a => a.priority), ['P1', 'P2', 'P3'])
  assert.equal(queue.actions[0].action, 'recapture_or_investigate_failure')
})
