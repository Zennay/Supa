import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { auditPrivateRetailerCaptureEvents } from '../scripts/qa-retailer-reviewed-event-consistency.mjs'

const asOf = '2026-10-15T00:00:00.000Z'
const review = data => auditPrivateRetailerCaptureEvents(data, { asOf })
function extraReplay(batch, key = 'plus:product') {
  const copied = structuredClone(batch.results.find(row => row.key === key))
  assert.ok(copied)
  const retailer = key.split(':')[0]
  batch.results.push(copied)
  batch.summary.sources++
  batch.summary.acceptedSources++
  batch.summary.observations += copied.observations.length
  batch.summary.retailerCounts[retailer] += copied.observations.length
  return copied
}
function changeCapture(row, stamp) {
  for (const observation of row.observations) observation.provenance.capturedAt = stamp
}

test('reviewed UTC-offset source capture is accepted with unchanged rights and observation totals', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const original = batch.results[0].observations[0].provenance.capturedAt
  const equivalentOffset = new Date(Date.parse(original) + 3600000).toISOString()
    .replace('Z', '+01:00')
  changeCapture(batch.results[0], equivalentOffset)
  const report = review(batch)
  assert.equal(report.reviewedObservations, batch.summary.observations)
  assert.equal(report.sourceResults, 6)
  assert.equal(report.distinctPhysicalEvents, 6)
  assert.equal(report.permissionVerified, false)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.externalRequests, 0)
})

test('equivalent absolute clock with different lexical offset is idempotent, not a new capture', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const copy = extraReplay(batch)
  const original = copy.observations[0].provenance.capturedAt
  const equivalent = new Date(Date.parse(original) + 3600000).toISOString()
    .replace('Z', '+01:00')
  changeCapture(copy, equivalent)
  const result = review(batch)
  assert.equal(result.sourceResults, 7)
  assert.equal(result.distinctPhysicalEvents, 6)
  assert.equal(result.idempotentEventReplays, 1)
})

test('same instant encoded with an offset cannot hide altered observed price', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const copy = extraReplay(batch)
  const original = copy.observations[0].provenance.capturedAt
  changeCapture(copy, new Date(Date.parse(original) + 3600000).toISOString().replace('Z', '+01:00'))
  const originalPrice = copy.observations[0].currentPriceCents
  copy.observations[0].currentPriceCents = originalPrice === null ? 120 : originalPrice + 1
  assert.throws(() => review(batch), /Private retailer event consistency QA refused/)
})

test('two distinct nanosecond capture instants are never collapsed into one millisecond event', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const a = extraReplay(batch)
  const b = extraReplay(batch)
  const original = a.observations[0].provenance.capturedAt
  assert.match(original, /\.\d{3}Z$/)
  changeCapture(a, original.replace(/Z$/, '123456Z'))
  changeCapture(b, original.replace(/Z$/, '123457Z'))
  const output = review(batch)
  assert.equal(output.sourceResults, 8)
  assert.equal(output.distinctPhysicalEvents, 8)
  assert.equal(output.idempotentEventReplays, 0)
  assert.equal(output.publicSavingsClaimEligible, false)
})

test('valid minute-only and 9-digit source clock formats remain admitted as private evidence', async () => {
  for (const stamp of ['2026-10-04T18:08Z', '2026-10-04T18:08:57.837123456Z']) {
    const batch = await loadReviewedRepositoryFixtures()
    changeCapture(batch.results[0], stamp)
    assert.equal(review(batch).distinctPhysicalEvents, 6, stamp)
  }
})

test('invalid calendar, leap/clock/offset bounds and >9-digit precision still fail closed', async () => {
  for (const stamp of [
    '2026-02-30T12:00:00Z',
    '2026-10-04T24:00:00Z',
    '2026-10-04T18:60:00Z',
    '2026-10-04T18:08:60Z',
    '2026-10-04T18:08:00+24:00',
    '2026-10-04T18:08:00+01:60',
    '2026-10-04T18:08:00.1234567890Z',
    '2035-10-04T18:08:00.123456789Z',
  ]) {
    const batch = await loadReviewedRepositoryFixtures()
    changeCapture(batch.results[0], stamp)
    assert.throws(() => review(batch), /Private retailer event consistency QA refused/, stamp)
  }
})

test('private review reference clock remains immutable and refuses future nanosecond instants', async () => {
  const batch = await loadReviewedRepositoryFixtures()
  const captured = '2026-10-15T00:00:00.000000001Z'
  changeCapture(batch.results[0], captured)
  assert.throws(() => review(batch), /Private retailer event consistency QA refused/)
  const result = auditPrivateRetailerCaptureEvents(batch, { asOf: '2026-10-15T00:00:01Z' })
  assert.equal(result.productionEnabled, false)
  assert.equal(result.externalRequests, 0)
})
