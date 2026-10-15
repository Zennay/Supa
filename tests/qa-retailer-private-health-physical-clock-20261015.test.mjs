import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'

// Independent reviewer acceptance on the *actual product health boundary*.
// Six existing archived PLUS/Deka adapter shapes. No retailer I/O, prices,
// source URLs or PII are emitted; none of these fixtures license publication.
const copy = object => structuredClone(object)
const deadline = batch => new Date(Math.max(...batch.results.flatMap(r =>
  r.observations.map(o => Date.parse(o.provenance.capturedAt)))) + 3600000).toISOString()
async function archived() {
  const batch = await loadReviewedRepositoryFixtures()
  assert.equal(batch.summary.acceptedSources, 6)
  assert.equal(batch.summary.rejectedSources, 0)
  return batch
}
function changeClock(result, clock) {
  for (const observation of result.observations) {
    observation.provenance.capturedAt = clock
  }
}
function offsetEquivalent(stamp) {
  const offset = new Date(Date.parse(stamp) + 3600000).toISOString().replace('Z', '+01:00')
  assert.equal(Date.parse(offset), Date.parse(stamp))
  assert.notEqual(offset, stamp)
  return offset
}
function addSameSource(batch) {
  const result = copy(batch.results.find(row => row.key === 'plus:product'))
  assert.ok(result?.accepted)
  batch.results.push(result)
  batch.summary.sources++
  batch.summary.acceptedSources++
  batch.summary.observations += result.observations.length
  batch.summary.retailerCounts.plus += result.observations.length
  assert.equal(batch.summary.sources, batch.results.length)
  return result
}
async function oneSource() {
  const batch = await archived()
  const first = copy(batch.results.find(row => row.key === 'plus:product'))
  const count = first.observations.length
  assert.ok(count > 0)
  batch.results = [first]
  batch.summary.sources = 1
  batch.summary.acceptedSources = 1
  batch.summary.rejectedSources = 0
  batch.summary.observations = count
  batch.summary.retailerCounts = { plus: count, dekamarkt: 0 }
  return batch
}
function privateOnly(report) {
  assert.equal(report.permissionVerified, false)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.livePricesAvailable, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.externalRequests, 0)
}

test('positive: complete six-shape archived health remains privately reviewable', async () => {
  const batch = await archived()
  const report = evaluatePrivateAdapterHealth(batch, { referenceTime: deadline(batch) })
  assert.equal(report.sources, 6)
  assert.equal(report.acceptedSources, 6)
  assert.equal(report.sixShapeCoverageComplete, true)
  privateOnly(report)
})

test('positive: a single valid offset representation still gives the same physical health result', async () => {
  const batch = await archived()
  const before = evaluatePrivateAdapterHealth(batch, { referenceTime: deadline(batch) })
  const original = batch.results[0].observations[0].provenance.capturedAt
  changeClock(batch.results[0], offsetEquivalent(original))
  const after = evaluatePrivateAdapterHealth(batch, { referenceTime: deadline(batch) })
  assert.deepEqual(after, before)
  privateOnly(after)
})

test('QA: +01:00 and Z must not impersonate TWO distinct capture events in source health', async () => {
  const batch = await archived()
  const replay = addSameSource(batch)
  changeClock(replay, offsetEquivalent(replay.observations[0].provenance.capturedAt))
  await assert.throws(() => evaluatePrivateAdapterHealth(batch, {
    referenceTime: deadline(batch),
  }), /Private retailer adapter health review refused/,
  'an ISO clock offset is not proof of a second physical capture')
})

test('QA: equivalent clock replays may not attach a contradictory physical price to the same SHA', async () => {
  const batch = await archived()
  const replay = addSameSource(batch)
  changeClock(replay, offsetEquivalent(replay.observations[0].provenance.capturedAt))
  const fact = replay.observations[0]
  fact.currentPriceCents = fact.currentPriceCents === null ? 111 : fact.currentPriceCents + 1
  assert.throws(() => evaluatePrivateAdapterHealth(batch, {
    referenceTime: deadline(batch),
  }), /Private retailer adapter health review refused/,
  'equal source+sha+physical instant cannot acquire new money facts by offset spelling')
})

test('QA: a capture 1ns beyond the audit clock cannot become historical after millisecond truncation', async () => {
  const batch = await oneSource()
  const ref = batch.results[0].observations[0].provenance.capturedAt
  assert.match(ref, /\.\d{3}Z$/)
  const future = ref.replace(/Z$/, '000001Z')
  assert.equal(Date.parse(ref), Date.parse(future))
  changeClock(batch.results[0], future)
  assert.throws(() => evaluatePrivateAdapterHealth(batch, { referenceTime: ref }),
    /Private retailer adapter health review refused/,
    'future capture nanoseconds must not be rounded down to same millisecond')
})

test('QA: physically impossible +15:00 source offset must not pass reviewer health even if Date.parse accepts it', async () => {
  const batch = await oneSource()
  const old = batch.results[0].observations[0].provenance.capturedAt
  const impossible = old.replace(/Z$/, '+15:00')
  assert.ok(Number.isFinite(Date.parse(impossible)), 'JS Date.parse accepts this invalid civil offset')
  changeClock(batch.results[0], impossible)
  assert.throws(() => evaluatePrivateAdapterHealth(batch, {
    referenceTime: deadline(batch),
  }), /Private retailer adapter health review refused/,
  'the reviewed source clock must be a possible civil UTC offset')
})
