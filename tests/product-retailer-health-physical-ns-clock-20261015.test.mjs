import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'

const clone = x => structuredClone(x)
const time = b => new Date(Math.max(...b.results.flatMap(row =>
  row.observations.map(o => Date.parse(o.provenance.capturedAt)))) + 3600000).toISOString()
async function historical() { return loadReviewedRepositoryFixtures() }
function setClock(result, value) {
  for (const observation of result.observations) observation.provenance.capturedAt = value
}
function duplicatePhysicalResult(batch) {
  const extra = clone(batch.results.find(row => row.key === 'plus:product'))
  assert.ok(extra)
  batch.results.push(extra)
  batch.summary.sources++
  batch.summary.acceptedSources++
  batch.summary.observations += extra.observations.length
  batch.summary.retailerCounts.plus += extra.observations.length
  return extra
}
async function single() {
  const batch = await historical()
  const r = clone(batch.results.find(row => row.key === 'plus:product'))
  const count = r.observations.length
  batch.results = [r]
  batch.summary.sources = 1
  batch.summary.acceptedSources = 1
  batch.summary.rejectedSources = 0
  batch.summary.observations = count
  batch.summary.retailerCounts = { plus: count, dekamarkt: 0 }
  return batch
}
test('unchanged six reviewed PLUS/Deka historical shapes are private and valid', async () => {
  const batch = await historical()
  const summary = evaluatePrivateAdapterHealth(batch, { referenceTime: time(batch) })
  assert.equal(summary.acceptedSources, 6)
  assert.equal(summary.sixShapeCoverageComplete, true)
  assert.equal(summary.productionEnabled, false)
  assert.equal(summary.permissionVerified, false)
  assert.equal(summary.publicSavingsClaimEligible, false)
  assert.equal(summary.externalRequests, 0)
})
test('equivalent legal offset time alone retains same aggregated six-shape health', async () => {
  const b = await historical()
  const original = evaluatePrivateAdapterHealth(b, { referenceTime: time(b) })
  const stamp = b.results[0].observations[0].provenance.capturedAt
  setClock(b.results[0], new Date(Date.parse(stamp) + 3600000).toISOString().replace('Z', '+01:00'))
  assert.deepEqual(evaluatePrivateAdapterHealth(b, { referenceTime: time(b) }), original)
})
test('same SHA, URL and physical UTC instant cannot be re-admitted with offset notation', async () => {
  const b = await historical()
  const extra = duplicatePhysicalResult(b)
  const stamp = extra.observations[0].provenance.capturedAt
  setClock(extra, new Date(Date.parse(stamp) + 3600000).toISOString().replace('Z', '+01:00'))
  assert.throws(() => evaluatePrivateAdapterHealth(b, { referenceTime: time(b) }),
    /Private retailer adapter health review refused/)
})
test('future 1 nanosecond is not rounded down to audit clock millisecond', async () => {
  const b = await single()
  const at = b.results[0].observations[0].provenance.capturedAt
  assert.match(at, /\.\d{3}Z$/)
  setClock(b.results[0], at.replace(/Z$/, '000001Z'))
  assert.throws(() => evaluatePrivateAdapterHealth(b, { referenceTime: at }),
    /Private retailer adapter health review refused/)
})
test('impossible civil offsets ±15:00 and +14:30 fail closed', async () => {
  const b = await single()
  const at = b.results[0].observations[0].provenance.capturedAt
  for (const offset of ['+15:00', '-15:00', '+14:30', '-14:01']) {
    setClock(b.results[0], at.replace(/Z$/, offset))
    assert.throws(() => evaluatePrivateAdapterHealth(b, { referenceTime: time(b) }),
      /Private retailer adapter health review refused/)
  }
})
