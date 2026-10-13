import assert from 'node:assert/strict'
import test from 'node:test'

import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// All inputs are invented local observations; no network, retailers, rights,
// sessions, prices, permissions or production use are part of these checks.
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function capture({
  id = 'fictional-source',
  supermarket = 'fictional-market-a',
  kind = 'product',
  sha = HASH_A,
} = {}) {
  return {
    id, supermarket, kind, success: true,
    integrity: 'verified',
    manifestSha256: sha,
    html: {
      hasNextData: false,
      jsonLd: [],
      applicationJsonScripts: [],
    },
    schemaOrgProduct: { type: 'abstain' },
  }
}

function inspection(source) {
  return { sourceCount: 1, sources: [source] }
}

function compare(left, right) {
  const inputs = [inspection(left), inspection(right)]
  const before = JSON.stringify(inputs)
  const result = compareInspections(inputs[0], inputs[1])
  assert.equal(JSON.stringify(inputs), before, 'inspections must remain untouched')
  assert.equal(result.productionReady, false)
  assert.equal(result.m5Eligible, false)
  assert.equal(result.reviewerActionRequired, true)
  return result
}

test('M5 QA positive: exact source origin and fingerprint remains P3 manual only', () => {
  const result = compare(capture(), capture())
  assert.equal(result.driftCount, 0)
  assert.equal(result.changes[0].status, 'unchanged')
  const queue = buildOfflineSelectorReviewQueue(result)
  assert.equal(queue.actions[0].priority, 'P3')
  assert.equal(queue.actions[0].selectorVerified, false)
  assert.equal(queue.actions[0].rightsVerified, false)
  assert.equal(queue.actions[0].productionEnabled, false)
  assert.equal(queue.productionReady, false)
  assert.equal(queue.m5Eligible, false)
})

test('M5 QA positive: same-origin HTML checksum drift remains P2 and never auto-approved', () => {
  const result = compare(capture({ sha: HASH_B }), capture())
  assert.equal(result.changes[0].status, 'content_changed_shape_stable')
  const queue = buildOfflineSelectorReviewQueue(result)
  assert.equal(queue.actions[0].priority, 'P2')
  assert.equal(queue.actions[0].rightsVerified, false)
  assert.equal(queue.actions[0].selectorVerified, false)
})

test('M5 QA RED: swapping store origin with same ID/hash/shape is not unchanged', () => {
  const result = compare(capture({ supermarket: 'fictional-market-b' }), capture())
  assert.notEqual(result.changes[0].status, 'unchanged')
})

test('M5 QA RED: swapping capture kind with same ID/hash/shape is not unchanged', () => {
  const result = compare(capture({ kind: 'category' }), capture())
  assert.notEqual(result.changes[0].status, 'unchanged')
})

test('M5 QA RED: store-origin mutation may not become low-priority P3 review', () => {
  const result = compare(capture({ supermarket: 'fictional-market-b' }), capture())
  const queue = buildOfflineSelectorReviewQueue(result)
  assert.equal(queue.actions.length, 1)
  assert.equal(queue.actions[0].priority, 'P1')
  assert.equal(queue.productionReady, false)
  assert.equal(queue.rightsVerified, false)
  assert.equal(queue.selectorVerified, false)
  assert.equal(queue.actions[0].productionEnabled, false)
})

test('M5 QA RED: capture-kind mutation may not become low-priority P3 review', () => {
  const result = compare(capture({ kind: 'category' }), capture())
  const queue = buildOfflineSelectorReviewQueue(result)
  assert.equal(queue.actions.length, 1)
  assert.equal(queue.actions[0].priority, 'P1')
  assert.equal(queue.productionReady, false)
  assert.equal(queue.rightsVerified, false)
  assert.equal(queue.selectorVerified, false)
  assert.equal(queue.actions[0].productionEnabled, false)
})
