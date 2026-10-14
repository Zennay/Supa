import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

const HASH = 'a'.repeat(64)
const SHAPE = 'b'.repeat(64)
const verified = (id) => ({
  id, supermarket: 'fictional-market', kind: 'product',
  captureStatus: 'verified', snapshotSha256: HASH,
  shapeSha256: SHAPE, schemaOrgStatus: 'abstain',
  hasNextData: false, jsonLdCount: 0, jsonLdParseErrors: 0,
})
const unavailable = (id) => ({
  id, supermarket: 'fictional-market', kind: 'product',
  captureStatus: 'unavailable', snapshotSha256: null,
  shapeSha256: null, schemaOrgStatus: 'unknown',
})
const removed = (id) => ({
  id, status: 'removed', current: null, baseline: verified(id),
})
const added = (id) => ({
  id, status: 'added', current: verified(id), baseline: null,
})
const change = (id, status, current, baseline = null) => ({
  id, status, current, baseline,
})
const drift = new Set(['unavailable', 'removed', 'added', 'origin_changed', 'shape_changed'])
const comparison = (changes, baselineProvided = true) => ({
  contractVersion: 1, mode: 'offline_capture_signature_review_only',
  productionReady: false, m5Eligible: false,
  reviewerActionRequired: true, baselineProvided,
  captureCount: changes.filter((entry) => entry.current !== null).length,
  driftCount: changes.filter((entry) => drift.has(entry.status)).length,
  changes,
})
const refuse = (report) => assert.throws(
  () => buildOfflineSelectorReviewQueue(report),
  /^Error: Invalid offline capture comparison report$/,
)

test('product M5 cohort: 101 historical-only captures cannot enter 100-source M1 queue', () => {
  const changes = Array.from({ length: 101 }, (_, index) => removed('old-' + index))
  const report = comparison(changes)
  refuse(report)
  assert.equal(report.changes.length, 101)
  assert.equal(report.captureCount, 0)
})

test('product M5 cohort: dense 200 historical-only captures refused despite valid 200-action union size', () => {
  const changes = Array.from({ length: 200 }, (_, index) => removed('old-' + index))
  const report = comparison(changes)
  refuse(report)
  assert.equal(report.changes.length, 200)
  assert.equal(report.driftCount, 200)
})

test('product M5 cohort: 100 historical-only removals are legal within physical cap', () => {
  const changes = Array.from({ length: 100 }, (_, index) => removed('old-' + index))
  const output = buildOfflineSelectorReviewQueue(comparison(changes))
  assert.equal(output.sourceCount, 0)
  assert.equal(output.actions.length, 100)
  assert.equal(output.driftCount, 100)
  assert.ok(output.actions.every((value) => value.priority === 'P1'))
  assert.equal(output.productionReady, false)
  assert.equal(output.m5Eligible, false)
})

test('product M5 cohort: disjoint 100 current and 100 historical snapshots pass 200-action union', () => {
  const previous = Array.from({ length: 100 }, (_, index) => removed('old-' + index))
  const current = Array.from({ length: 100 }, (_, index) => added('new-' + index))
  const output = buildOfflineSelectorReviewQueue(comparison([...previous, ...current]))
  assert.equal(output.actions.length, 200)
  assert.equal(output.sourceCount, 100)
  assert.equal(output.driftCount, 200)
  assert.equal(output.productionReady, false)
  assert.equal(output.m5Eligible, false)
})

test('product M5 cohort: no-baseline P1 unavailable cannot smuggle verified historical metadata', () => {
  const label = 'private-source'
  const report = comparison([
    change(label, 'unavailable', unavailable(label), verified(label)),
  ], false)
  refuse(report)
  assert.equal(report.baselineProvided, false)
})

test('product M5 cohort: no-baseline P1 unavailable cannot smuggle failed historical metadata', () => {
  const label = 'private-source'
  refuse(comparison([
    change(label, 'unavailable', unavailable(label), unavailable(label)),
  ], false))
})

test('product M5 cohort: no-baseline P1 unavailable with truly null historical record remains valid', () => {
  const id = 'failed'
  const original = comparison([change(id, 'unavailable', unavailable(id))], false)
  const before = structuredClone(original)
  const result = buildOfflineSelectorReviewQueue(original)
  assert.deepEqual(original, before)
  assert.equal(result.actions[0].priority, 'P1')
  assert.equal(result.baselineProvided, false)
  assert.equal(result.m5Eligible, false)
})

test('product M5 cohort: baseline-provided new success remains P2', () => {
  const input = comparison([added('new')], true)
  const result = buildOfflineSelectorReviewQueue(input)
  assert.equal(result.actions[0].priority, 'P2')
  assert.equal(result.actions[0].status, 'added')
})

test('product M5 cohort: no-baseline new successful source remains P2 manual baseline', () => {
  const id = 'first'
  const result = buildOfflineSelectorReviewQueue(comparison([
    change(id, 'baseline_missing', verified(id)),
  ], false))
  assert.equal(result.actions[0].priority, 'P2')
  assert.equal(result.actions[0].status, 'baseline_missing')
  assert.equal(result.m5Eligible, false)
})

test('product M5 cohort: real older unchanged baseline still leads to P3', () => {
  const id = 'unchanged'
  const result = buildOfflineSelectorReviewQueue(comparison([
    change(id, 'unchanged', verified(id), verified(id)),
  ]))
  assert.equal(result.actions[0].status, 'unchanged')
  assert.equal(result.actions[0].priority, 'P3')
})

test('product M5 cohort: empty current and empty baseline is still a nonproduction review', () => {
  const result = buildOfflineSelectorReviewQueue(comparison([]))
  assert.deepEqual(result.actions, [])
  assert.equal(result.sourceCount, 0)
  assert.equal(result.baselineProvided, true)
  assert.equal(result.m5Eligible, false)
})

test('product M5 cohort: invalid population leaves private synthetic input pristine', () => {
  const changes = Array.from({ length: 102 }, (_, index) => removed('sensitive-' + index))
  const candidate = comparison(changes)
  const frozen = structuredClone(candidate)
  refuse(candidate)
  assert.deepEqual(candidate, frozen)
})

test('product M5 cohort: valid tokens do not expose fictional source labels', () => {
  const name = 'fictional-private-source'
  const report = comparison([added(name)])
  const output = buildOfflineSelectorReviewQueue(report)
  assert.doesNotMatch(JSON.stringify(output), /fictional-private-source|fictional-market/)
  assert.match(output.actions[0].sourceToken, /^[a-f0-9]{64}$/)
  assert.equal(output.rightsVerified, false)
  assert.equal(output.selectorVerified, false)
})
