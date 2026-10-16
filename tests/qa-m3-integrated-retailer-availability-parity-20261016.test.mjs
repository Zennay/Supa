import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { assessPrivateM3RetailerIngestion } from '../scripts/retailer-private-m3-ingestion-preflight.mjs'
import { reviewPrivateRetailerAvailability } from '../scripts/qa-retailer-availability-triage.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Independent differential acceptance: source code and eight original tests
// are unmodified from the GREEN standalone QA. Owner preflight untouched.
// This is historical offline evidence only, never actual retail availability.
const AT = '2026-10-16T00:00:00.000Z'
const shapes = ['plus:product', 'plus:catalog', 'plus:offers',
  'dekamarkt:product', 'dekamarkt:catalog', 'dekamarkt:offers']

async function inputs() {
  return {
    rights: JSON.parse(await readFile(
      new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8')),
    batch: structuredClone(await loadReviewedRepositoryFixtures()),
  }
}

function compare(rights, batch) {
  const before = structuredClone(batch)
  const qa = reviewPrivateRetailerAvailability(batch, { referenceTime: AT })
  const preflight = assessPrivateM3RetailerIngestion(rights, batch, { referenceTime: AT })

  assert.equal(qa.historicalObservations, preflight.acceptedHistoricalObservations)
  assert.equal(qa.perShape.length, 6)
  assert.equal(preflight.perSourceShape.length, 6)
  for (const key of shapes) {
    const [retailer, kind] = key.split(':')
    const source = qa.perShape.find(row => row.retailer === retailer && row.kind === kind)
    const integrated = preflight.perSourceShape.find(
      row => row.retailer === retailer && row.kind === kind)
    assert.ok(source && integrated, 'missing source-kind ' + key)
    assert.equal(source.historicalObservations, integrated.archivedObservations, key)
    assert.equal(source.available, integrated.availableHistoricalObservations, key + ' available')
    assert.equal(source.unavailable, integrated.unavailableHistoricalObservations, key + ' unavailable')
    assert.equal(source.unknown, integrated.unknownHistoricalAvailability, key + ' unknown')
    assert.equal(source.available + source.unavailable + source.unknown,
      integrated.archivedObservations)
  }
  assert.equal(qa.availability.available, preflight.historicalStockAvailableObservations)
  assert.equal(qa.availability.unavailable, preflight.historicalStockUnavailableObservations)
  assert.equal(qa.availability.unknown, preflight.historicalStockUnknownObservations)
  assert.equal(qa.availability.available + qa.availability.unavailable +
    qa.availability.unknown, preflight.acceptedHistoricalObservations)
  assert.equal(preflight.currentStockCoverageVerified, false)
  assert.equal(qa.currentStockVerified, false)
  assert.equal(qa.historicalOnly, true)
  assert.equal(preflight.historicalReviewedOnly, true)
  assert.equal(qa.permissionVerified, false)
  assert.equal(preflight.permissionVerified, false)
  assert.equal(qa.releaseDecision, 'hold')
  assert.equal(preflight.releaseDecision, 'hold')
  assert.equal(qa.productionEnabled, false)
  assert.equal(preflight.productionEnabled, false)
  assert.equal(qa.publicSavingsClaimEligible, false)
  assert.equal(preflight.publicSavingsClaimEligible, false)
  assert.equal(qa.liveRequests, 0)
  assert.equal(preflight.liveRequests, 0)
  assert.deepEqual(batch, before, 'neither reviewer can mutate archived source bytes')

  const output = JSON.stringify({ qa, preflight })
  assert.doesNotMatch(output,
    /https?:\/\/|sourceProductId|sourceUrl|snapshotSha256|offerPriceCents|currentPriceCents/i)
  for (const row of batch.results) {
    for (const observation of row.observations) {
      assert.equal(output.includes(observation.name), false)
      assert.equal(output.includes(observation.provenance.sha256), false)
      assert.equal(output.includes(observation.provenance.url), false)
    }
  }
  return { qa, preflight }
}

test('real immutable six reviewed PLUS/Deka shapes exactly agree between independent QA and M3 operator', async () => {
  const { rights, batch } = await inputs()
  compare(rights, batch)
})

test('unavailable historical source observations never become purchasable in either output', async () => {
  const { rights, batch } = await inputs()
  for (const source of batch.results) {
    for (const row of source.observations) row.availability = 'unavailable'
  }
  const { qa } = compare(rights, batch)
  assert.equal(qa.availability.unavailable, qa.historicalObservations)
  assert.equal(qa.availability.available, 0)
})

test('all unknown historical stock remains unknown in both independent output paths', async () => {
  const { rights, batch } = await inputs()
  for (const source of batch.results) {
    for (const row of source.observations) row.availability = 'unknown'
  }
  const { qa } = compare(rights, batch)
  assert.equal(qa.availability.unknown, qa.historicalObservations)
  assert.equal(qa.availability.available, 0)
})

test('all historical available markers are still NEVER presented as verified current inventory', async () => {
  const { rights, batch } = await inputs()
  for (const source of batch.results) {
    for (const row of source.observations) row.availability = 'available'
  }
  const { qa } = compare(rights, batch)
  assert.equal(qa.availability.available, qa.historicalObservations)
})

test('mixed source-kind stock uncertainty reconciles without cross-store status transfer', async () => {
  const { rights, batch } = await inputs()
  for (let i = 0; i < batch.results.length; i++) {
    const target = ['available', 'unknown', 'unavailable'][i % 3]
    for (const row of batch.results[i].observations) row.availability = target
  }
  compare(rights, batch)
})

test('forged source-permission escalation is refused by both independent gates', async () => {
  const { rights, batch } = await inputs()
  batch.summary.permissionVerified = true
  assert.throws(() => reviewPrivateRetailerAvailability(batch, { referenceTime: AT }))
  assert.throws(() => assessPrivateM3RetailerIngestion(rights, batch, {
    referenceTime: AT,
  }))
})
