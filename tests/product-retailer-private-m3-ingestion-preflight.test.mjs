import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  assessPrivateM3RetailerIngestion,
  main,
} from '../scripts/retailer-private-m3-ingestion-preflight.mjs'
import {
  loadReviewedRepositoryFixtures,
} from '../scripts/retailer-reviewed-ingest-engine.mjs'

const AT = '2026-10-15T10:00:00.000Z'
const script = fileURLToPath(new URL(
  '../scripts/retailer-private-m3-ingestion-preflight.mjs', import.meta.url))

async function realOfflineInputs() {
  const rights = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  const batch = await loadReviewedRepositoryFixtures()
  return { rights, batch }
}

test('one private M3 preflight binds real six reviewed adapter shapes, catalog, rights and offer checks', async () => {
  const { rights, batch } = await realOfflineInputs()
  const report = assessPrivateM3RetailerIngestion(rights, batch, { referenceTime: AT })
  assert.equal(report.mode, 'private-m3-integrated-ingestion-preflight')
  assert.equal(report.acceptedSourceShapes, 6)
  assert.equal(report.requiredSourceShapes, 6)
  assert.equal(report.missingSourceShapes, 0)
  assert.equal(report.completeHistoricalSourceShapeCoverage, true)
  assert.equal(report.perSourceShape.length, 6)
  assert.deepEqual(
    [...new Set(report.perSourceShape.map(row => row.retailer))].sort(),
    ['dekamarkt', 'plus'],
  )
  assert.deepEqual(
    [...new Set(report.perSourceShape.map(row => row.kind))].sort(),
    ['catalog', 'offers', 'product'],
  )
  assert.equal(
    report.perSourceShape.reduce((sum, row) => sum + row.archivedObservations, 0),
    report.acceptedHistoricalObservations,
  )
  assert.ok(report.perSourceShape.every(row =>
    row.verifiedCurrentPriceObservations === 0 &&
    !Object.hasOwn(row, 'sourceUrl') &&
    !Object.hasOwn(row, 'sha256') &&
    !Object.hasOwn(row, 'productName')),
  )
  assert.equal(report.currentStockCoverageVerified, false)
  assert.equal(report.historicalStockAvailableObservations +
    report.historicalStockUnavailableObservations +
    report.historicalStockUnknownObservations,
    report.acceptedHistoricalObservations)
  assert.ok(report.perSourceShape.every(row =>
    row.unknownHistoricalAvailability +
      row.unavailableHistoricalObservations +
      row.availableHistoricalObservations === row.archivedObservations))
  assert.ok(report.acceptedHistoricalObservations > 0)
  assert.ok(report.normalizedPrivateProducts > 0)
  assert.ok(report.archivedOfferRows > 0)
  assert.ok(report.corroboratedHistoricalOfferBaselines <= report.archivedOfferRows)
  assert.equal(
    report.uncorroboratedHistoricalOfferRows,
    report.archivedOfferRows - report.corroboratedHistoricalOfferBaselines,
  )
  assert.equal(report.releaseDecision, 'hold')
  assert.equal(report.permissionVerified, false)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.liveRequests, 0)
  assert.equal(report.requiresGenuineM3FieldEvidence, true)
  assert.ok(report.operatorActions.includes('obtain-written-retailer-reuse-rights'))
  assert.ok(report.operatorActions.some(value => value.includes('same-context-basket')))
  // This historical evidence is allowed to be stale; no current price truth.
  assert.equal(report.livePricesAvailable, false)
  assert.equal(report.unavailableCurrentPriceCoverage, true)
})

test('canonical offline source stock is carried through per shape without promoting current availability', async () => {
  const { rights, batch } = await realOfflineInputs()
  const saved = structuredClone(batch)
  const baseline = assessPrivateM3RetailerIngestion(rights, batch, {
    referenceTime: AT,
  })
  const counts = baseline.perSourceShape
  assert.equal(counts.length, 6)
  assert.ok(baseline.historicalStockUnknownObservations > 0)
  assert.equal(baseline.currentStockCoverageVerified, false)
  assert.ok(baseline.operatorActions.includes(
    'review-unknown-historical-retailer-stock'))
  assert.deepEqual(batch, saved, 'inspection must not alter reviewed data')
  for (const availability of ['unavailable', 'unknown', 'available']) {
    const mutated = structuredClone(batch)
    for (const result of mutated.results) {
      for (const ob of result.observations) ob.availability = availability
    }
    const report = assessPrivateM3RetailerIngestion(rights, mutated, {
      referenceTime: AT,
    })
    assert.equal(report.currentStockCoverageVerified, false)
    assert.equal(report.releaseDecision, 'hold')
    assert.equal(report.permissionVerified, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    for (const row of report.perSourceShape) {
      assert.equal(row.unknownHistoricalAvailability,
        availability === 'unknown' ? row.archivedObservations : 0)
      assert.equal(row.unavailableHistoricalObservations,
        availability === 'unavailable' ? row.archivedObservations : 0)
      assert.equal(row.availableHistoricalObservations,
        availability === 'available' ? row.archivedObservations : 0)
    }
  }
})

test('tampering source permission truth is never promoted to private or public readiness', async () => {
  const { rights, batch } = await realOfflineInputs()
  const forged = structuredClone(batch)
  forged.summary.permissionVerified = true
  assert.throws(() => assessPrivateM3RetailerIngestion(rights, forged, {
    referenceTime: AT,
  }))
  const forgedCounts = structuredClone(batch)
  forgedCounts.summary.observations++
  assert.throws(() => assessPrivateM3RetailerIngestion(rights, forgedCounts, {
    referenceTime: AT,
  }))
})

test('bad clock and missing source result refuse the joined M3 review', async () => {
  const { rights, batch } = await realOfflineInputs()
  for (const clock of ['2026-02-30T10:00:00.000Z', '2026-10-15', 'yesterday',
    '2026-10-15T10:00:00.000000001Z']) {
    assert.throws(() => assessPrivateM3RetailerIngestion(rights, batch, {
      referenceTime: clock,
    }))
  }
  const missing = structuredClone(batch)
  missing.results.pop()
  assert.throws(() => assessPrivateM3RetailerIngestion(rights, missing, {
    referenceTime: AT,
  }))
})

test('CLI produces only safe aggregates; repeated calls never write evidence', async () => {
  const captured = []
  const report = await main(['--at', AT], line => captured.push(line))
  assert.equal(captured.length, 1)
  assert.deepEqual(JSON.parse(captured[0]), report)
  assert.doesNotMatch(captured[0], /https?:\/\//i)
  assert.doesNotMatch(captured[0], /snapshotSha256|sourceProductId|sourceUrl|currentPriceCents|\bsku\b/i)
  assert.equal(report.externalRequests, undefined)
  assert.equal(report.liveRequests, 0)
})

test('CLI rejects inherited slots and accessors before touching their getters', async () => {
  let calls = 0
  const argv = ['--at', AT]
  Object.defineProperty(argv, '1', { get() { calls++; return AT } })
  await assert.rejects(main(argv, () => { throw Error('must not emit') }),
    /preflight refused/)
  assert.equal(calls, 0)

  const inherited = new Array(2)
  Object.defineProperty(inherited, '0', { get() { calls++; return '--at' } })
  await assert.rejects(main(inherited), /preflight refused/)
  assert.equal(calls, 0)
})

test('real executable refuses invalid clock without leaking private data to stdout', () => {
  const result = spawnSync(process.execPath,
    ['--experimental-strip-types', script, '--at', 'not-a-clock'],
    { encoding: 'utf8', timeout: 20_000 })
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr.trim(), 'Private M3 integrated retailer preflight refused')
})
