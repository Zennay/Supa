import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  ingestReviewedBatch, loadReviewedRepositoryFixtures, RETAILER_REVIEWED_FIXTURES,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { planPrivateRetailerRollout } from '../scripts/retailer-private-source-rollout-matrix.mjs'

// Independent QA on frozen product #3037. ALL inputs are the six historical
// checked-in reviewed M1 fixtures, never a live supermarket capture.
// No network, HTTP mocks, production rights, personal data or observed savings.
const archived = new URL('../fixtures/m1/', import.meta.url)
const rightsPath = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const kind = (report) => report.retailers[0].shapes.find(shape => shape.kind === 'product')
const rights = () => readFile(rightsPath, 'utf8').then(JSON.parse)
const fixtureRecords = () => Promise.all(RETAILER_REVIEWED_FIXTURES.map(name =>
  readFile(new URL(name, archived), 'utf8').then(JSON.parse)))

test('independent: precisely 24h old PLUS historical record is within audit window; +1ns is stale', async () => {
  const records = await fixtureRecords()
  const batch = ingestReviewedBatch(records)
  const baseline = records[0].source.capturedAt
  const exact24h = new Date(Date.parse(baseline) + 24 * 60 * 60 * 1000).toISOString()
  const beyond24hNs = exact24h.replace(/Z$/u, '000001Z')
  const inputBefore = JSON.stringify(batch)
  const gate = await rights()
  const exact = planPrivateRetailerRollout(gate, batch, { referenceTime: exact24h })
  const beyond = planPrivateRetailerRollout(gate, batch, { referenceTime: beyond24hNs })
  assert.equal(kind(exact).status, 'historical-fixture-present')
  assert.equal(kind(exact).staleHistoricalCaptures, 0)
  assert.equal(kind(beyond).status, 'archived-capture-outside-review-window')
  assert.equal(kind(beyond).staleHistoricalCaptures, 1)
  assert.equal(kind(exact).latestArchivedCapturedAt, baseline)
  assert.equal(kind(beyond).latestArchivedCapturedAt, baseline)
  assert.equal(JSON.stringify(batch), inputBefore, 'operator review is read-only')
  for (const report of [exact, beyond]) {
    assert.equal(report.rightsGateProductionReady, false)
    assert.equal(report.permissionVerifiedForNewCapture, false)
    assert.equal(report.liveRetailerRequests, 0)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.productionEnabled, false)
  }
})

test('independent: three captures in one millisecond select physically latest nanosecond (not input order)', async () => {
  const records = await fixtureRecords()
  const original = records[0].source.capturedAt
  const one = structuredClone(records[0])
  const two = structuredClone(records[0])
  one.source.id += '-plus-one-ns'
  two.source.id += '-plus-two-ns'
  one.source.capturedAt = original.replace(/Z$/u, '000001Z')
  two.source.capturedAt = original.replace(/Z$/u, '000002Z')
  assert.equal(Date.parse(one.source.capturedAt), Date.parse(original))
  assert.equal(Date.parse(two.source.capturedAt), Date.parse(original))
  const gate = await rights()
  const audit = new Date(Date.parse(original) + 2 * 60 * 60 * 1000).toISOString()
  for (const order of [
    [two, ...records, one],
    [one, ...records, two],
    [...records, two, one],
  ]) {
    const report = planPrivateRetailerRollout(gate, ingestReviewedBatch(order),
      { referenceTime: audit })
    assert.equal(kind(report).historicalSources, 3)
    assert.equal(kind(report).acceptedSources, 3)
    assert.equal(kind(report).latestArchivedCapturedAt, two.source.capturedAt)
    assert.equal(kind(report).verifiedCurrentPriceObservations, 0)
    assert.equal(kind(report).eligibleForLiveCapture, false)
    const serialized = JSON.stringify(report)
    for (const source of [records[0].source.url, records[0].source.sha256,
      records[0].source.id]) {
      assert.equal(serialized.includes(source), false,
        'raw archived URL/hash/identity must not be disclosed in operator summary')
    }
  }
})

test('independent: audit reference one nanosecond before a real reviewed capture refuses the full matrix', async () => {
  const records = await fixtureRecords()
  const ts = records[0].source.capturedAt
  const earlier = new Date(Date.parse(ts) - 1).toISOString()
    .replace(/\.\d{3}Z$/u, matched => {
      const ms = matched.slice(1, 4)
      return '.' + ms + '999999Z'
    })
  // The reference time is one nanosecond before the parsed millisecond
  // of original, so it is definitely prior to the PLUS capture.
  assert.ok(Date.parse(earlier) < Date.parse(ts))
  const gate = await rights()
  assert.throws(() => planPrivateRetailerRollout(
    gate, ingestReviewedBatch(records), { referenceTime: earlier }),
    /refused|invalid|timestamp/i)
})
