import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'
import {
  RETAILER_REVIEWED_FIXTURES,
  ingestReviewedBatch, loadReviewedRepositoryFixtures,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'

const copy = value => structuredClone(value)
async function reviewedRecords() {
  return Promise.all(RETAILER_REVIEWED_FIXTURES.map(async file =>
    JSON.parse(await readFile(new URL('../fixtures/m1/' + file, import.meta.url), 'utf8'))))
}
const latestClock = batch => new Date(
  Math.max(...batch.results.flatMap(row => row.observations.map(obs =>
    Date.parse(obs.provenance.capturedAt)))) + 60 * 60 * 1000,
).toISOString()

describe('product: M1 retailer capture clocks align across six health adapters', () => {
  it('accepts an actual reviewed adapter record using an absolute +01:00 timestamp', async () => {
    const records = await reviewedRecords()
    const stamp = new Date(Date.parse(records[0].source.capturedAt) + 3600000)
      .toISOString().replace('Z', '+01:00')
    records[0].source.capturedAt = stamp
    const batch = ingestReviewedBatch(records)
    assert.equal(batch.summary.acceptedSources, 6)
    const report = evaluatePrivateAdapterHealth(batch, { referenceTime: latestClock(batch) })
    assert.equal(report.sixShapeCoverageComplete, true)
    assert.equal(report.sources, 6)
    assert.equal(report.productionEnabled, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.livePricesAvailable, false)
  })
  it('supports reviewer-accepted nanosecond timestamp fractions, without rounding a financial fact', async () => {
    const records = await reviewedRecords()
    const original = records[0].source.capturedAt
    const base = new Date(Date.parse(original)).toISOString()
    records[0].source.capturedAt = base.replace(/\.(\d{3})Z$/, '.$1000000Z')
    const batch = ingestReviewedBatch(records)
    assert.equal(batch.summary.acceptedSources, 6)
    const report = evaluatePrivateAdapterHealth(batch, { referenceTime: latestClock(batch) })
    assert.equal(report.sixShapeCoverageComplete, true)
    assert.equal(report.permissionVerified, false)
  })
  it('accepts minute-precision source timestamps that original adapters accept', async () => {
    const records = await reviewedRecords()
    records[0].source.capturedAt =
      new Date(Date.parse(records[0].source.capturedAt)).toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z')
    const batch = ingestReviewedBatch(records)
    assert.equal(batch.summary.acceptedSources, 6)
    assert.equal(evaluatePrivateAdapterHealth(batch, {
      referenceTime: latestClock(batch),
    }).acceptedSources, 6)
  })
  it('matches absolute instants for equivalent offset and Z review clocks', async () => {
    const batch = await loadReviewedRepositoryFixtures()
    const ref = latestClock(batch)
    const offset = new Date(Date.parse(ref) + 2 * 3600000).toISOString()
      .replace('Z', '+02:00')
    assert.deepEqual(
      evaluatePrivateAdapterHealth(batch, { referenceTime: ref }),
      evaluatePrivateAdapterHealth(batch, { referenceTime: offset }),
    )
  })
  it('continues rejecting non-calendar dates and time field overflows', async () => {
    const original = await loadReviewedRepositoryFixtures()
    for (const date of [
      '2026-02-30T12:00:00Z',
      '2026-10-15T24:00:00Z',
      '2026-10-15T12:60:00Z',
      '2026-10-15T12:00:60Z',
      '2026-10-15T12:00:00+24:00',
      '2026-10-15T12:00:00+01:60',
      '2026-10-15T12:00:00.1234567890Z',
    ]) {
      const b = copy(original)
      for (const observation of b.results[0].observations) {
        observation.provenance.capturedAt = date
      }
      assert.throws(() => evaluatePrivateAdapterHealth(b, {
        referenceTime: latestClock(original),
      }), /refused/, date)
    }
  })
  it('still rejects captures from the future relative to an explicit audit clock', async () => {
    const original = await loadReviewedRepositoryFixtures()
    const b = copy(original)
    const future = new Date(Date.parse(latestClock(original)) + 3600000).toISOString()
    for (const observation of b.results[0].observations) {
      observation.provenance.capturedAt = future
    }
    assert.throws(() => evaluatePrivateAdapterHealth(b, {
      referenceTime: latestClock(original),
    }), /refused/)
  })
  it('supports offset format in audit clock but never elevates permission', async () => {
    const batch = await loadReviewedRepositoryFixtures()
    const clock = latestClock(batch)
    const later = new Date(Date.parse(clock) + 4 * 3600000).toISOString().replace('Z', '+04:00')
    const report = evaluatePrivateAdapterHealth(batch, { referenceTime: later })
    assert.equal(report.permissionVerified, false)
    assert.equal(report.productionEnabled, false)
    assert.equal(report.externalRequests, 0)
  })
  it('bad clock input always uses generic private refusal, not raw sensitive source values', async () => {
    const batch = await loadReviewedRepositoryFixtures()
    assert.throws(() => evaluatePrivateAdapterHealth(batch, {
      referenceTime: 'https://www.plus.nl/product/private-example',
    }), /Private retailer adapter health review refused/)
  })
})
