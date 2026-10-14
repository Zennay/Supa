import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

// This independently composes the actual canonical M1 HTML inspector and M5
// signature comparator. Fictitious inline HTML only, zero retailer traffic.
const ld = '<script type="application/ld+json">{"@type":"Product","name":"X"}</script>'
const ldWithOffer = '<script type="application/ld+json">{"@type":"Product","name":"X","offers":{"price":"1"}}</script>'
const html = (title, data = ld) => '<html><head><title>' + title + '</title>' + data + '</head></html>'
function inspected(htmlText) {
  return {
    id: 'invented-source', supermarket: 'fictional-market', kind: 'product',
    success: true, integrity: 'verified',
    manifestSha256: createHash('sha256').update(htmlText).digest('hex'),
    html: inspectHtml(htmlText),
    schemaOrgProduct: { type: 'abstain' },
  }
}
const compare = (current, historical) => compareInspections(
  { sourceCount: 1, sources: [current] },
  { sourceCount: 1, sources: [historical] },
)

test('M1 + M5 real inspectors: identical verified synthetic HTML yields P3 and opaque review token', () => {
  const source = inspected(html('Same'))
  const baseline = inspected(html('Same'))
  const original = structuredClone([source, baseline])
  const report = compare(source, baseline)
  assert.equal(report.changes[0].status, 'unchanged')
  assert.equal(report.changes[0].current.snapshotSha256, report.changes[0].baseline.snapshotSha256)
  const result = buildOfflineSelectorReviewQueue(report)
  assert.equal(result.actions[0].priority, 'P3')
  assert.match(result.actions[0].sourceToken, /^[a-f0-9]{64}$/)
  assert.doesNotMatch(JSON.stringify(result), /invented-source|fictional-market/)
  assert.equal(result.productionReady, false)
  assert.equal(result.m5Eligible, false)
  assert.deepEqual([source, baseline], original)
})

test('M1 + M5 real inspectors: changed recognized JSON-LD content produces legitimate P1 shape review', () => {
  const current = inspected(html('Same', ldWithOffer))
  const previous = inspected(html('Same', ld))
  const result = compare(current, previous)
  assert.equal(result.changes[0].status, 'shape_changed')
  assert.notEqual(result.changes[0].current.snapshotSha256, result.changes[0].baseline.snapshotSha256)
  assert.notEqual(result.changes[0].current.shapeSha256, result.changes[0].baseline.shapeSha256)
  const queue = buildOfflineSelectorReviewQueue(result)
  assert.equal(queue.actions[0].priority, 'P1')
  assert.equal(queue.actions[0].selectorVerified, false)
  assert.equal(queue.actions[0].rightsVerified, false)
  assert.equal(queue.actions[0].productionEnabled, false)
})

test('M1 + M5 real inspectors: title-only content change remains P2 without false shape drift', () => {
  const current = inspected(html('Second title'))
  const previous = inspected(html('First title'))
  const report = compare(current, previous)
  assert.equal(report.changes[0].status, 'content_changed_shape_stable')
  assert.notEqual(report.changes[0].current.snapshotSha256, report.changes[0].baseline.snapshotSha256)
  assert.equal(report.changes[0].current.shapeSha256, report.changes[0].baseline.shapeSha256)
  const result = buildOfflineSelectorReviewQueue(report)
  assert.equal(result.actions[0].priority, 'P2')
  assert.equal(result.m5Eligible, false)
})

test('M1 + M5 real inspectors: tampered same-HTML structural digest cannot invent a P1 review task', () => {
  const capture = inspected(html('Identical'))
  const source = compare(capture, inspected(html('Identical')))
  const candidate = structuredClone(source)
  candidate.changes[0].current.shapeSha256 = 'f'.repeat(64)
  candidate.changes[0].status = 'shape_changed'
  candidate.driftCount = 1
  assert.equal(candidate.changes[0].current.snapshotSha256, candidate.changes[0].baseline.snapshotSha256)
  const before = structuredClone(candidate)
  assert.throws(() => buildOfflineSelectorReviewQueue(candidate),
    /^Error: Invalid offline capture comparison report$/)
  assert.deepEqual(candidate, before)
})
