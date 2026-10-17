// Independent SUPA quality-validation 1/2: this is an OFFLINE, read-only
// permutation oracle over the repository's six reviewed historical captures.
// None of these tests fetches retailers, grants source rights, or makes a
// current-stock/price/savings claim. The source fixture bytes stay unchanged.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { evaluateSourcePermissionGate } from '../scripts/m1-check-source-permission-gate.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { assessPrivateM3RetailerIngestion } from '../scripts/retailer-private-m3-ingestion-preflight.mjs'

const AT = '2026-10-15T10:00:00.000Z'
const SHAPES = ['dekamarkt:catalog', 'dekamarkt:offers', 'dekamarkt:product',
  'plus:catalog', 'plus:offers', 'plus:product']

async function canonicalInputs() {
  const rights = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  const batch = await loadReviewedRepositoryFixtures()
  assert.deepEqual(batch.results.map(r => r.key).sort(), SHAPES)
  assert.equal(batch.results.length, 6)
  return { rights, batch }
}

function verifyPrivateNoRelease(report) {
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.mode, 'private-m3-integrated-ingestion-preflight')
  assert.equal(report.requiredSourceShapes, 6)
  assert.equal(report.acceptedSourceShapes, 6)
  assert.equal(report.missingSourceShapes, 0)
  assert.equal(report.completeHistoricalSourceShapeCoverage, true)
  assert.equal(report.currentStockCoverageVerified, false)
  assert.equal(report.liveRequests, 0)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.livePricesAvailable, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.permissionVerified, false)
  assert.equal(report.releaseDecision, 'hold')
  assert.equal(report.requiresWrittenReuseRights, true)
  assert.equal(report.requiresGenuineM3FieldEvidence, true)
  assert.equal(report.perSourceShape.length, 6)
  assert.equal(new Set(report.perSourceShape.map(x => x.retailer + ':' + x.kind)).size, 6)
  assert.equal(report.perSourceShape.reduce((n, x) => n + x.archivedObservations, 0),
    report.acceptedHistoricalObservations)
  assert.equal(report.historicalStockUnknownObservations +
    report.historicalStockUnavailableObservations +
    report.historicalStockAvailableObservations, report.acceptedHistoricalObservations)
  assert.equal(report.archivedOfferRows + report.olderHistoricalOfferRowsNotCompared,
    report.allHistoricalOfferRows)
  assert.equal(report.corroboratedHistoricalOfferBaselines +
    report.uncorroboratedHistoricalOfferRows, report.archivedOfferRows)
  const serialized = JSON.stringify(report)
  assert.doesNotMatch(serialized, /https?:\/\/|sourceUrl|sourceProductId|productName|priceCents|snapshotSha256/i)
}

function reordered(batch, mode) {
  const value = structuredClone(batch)
  if (mode === 'reverse') value.results.reverse()
  else if (mode === 'kind-first') value.results.sort((a, b) =>
    a.key.split(':')[1].localeCompare(b.key.split(':')[1]) || a.key.localeCompare(b.key))
  else if (mode === 'lex-asc') value.results.sort((a, b) => a.key.localeCompare(b.key))
  else if (mode === 'lex-desc') value.results.sort((a, b) => b.key.localeCompare(a.key))
  else if (mode.startsWith('rotate-')) {
    const shift = Number(mode.slice(7))
    value.results = value.results.slice(shift).concat(value.results.slice(0, shift))
  } else throw new Error('unknown offline QA permutation')
  return value
}

test('real canonical source-rights registry is denied before any reviewed source permutation', async () => {
  const { rights, batch } = await canonicalInputs()
  const gate = evaluateSourcePermissionGate(rights)
  assert.equal(gate.productionReady, false)
  assert.deepEqual(gate.blockers.map(x => [x.supermarket, x.permissionStatus]), [
    ['plus', 'permission_required'], ['dekamarkt', 'unresolved'],
  ])
  const report = assessPrivateM3RetailerIngestion(rights, batch, { referenceTime: AT })
  verifyPrivateNoRelease(report)
})

for (const mode of ['reverse', 'kind-first', 'lex-asc', 'lex-desc',
  'rotate-1', 'rotate-2', 'rotate-3', 'rotate-4', 'rotate-5']) {
  test(`private six-source evidence metrics are invariant under ${mode} ordering`, async () => {
    const { rights, batch } = await canonicalInputs()
    const beforeRights = JSON.stringify(rights)
    const beforeBatch = JSON.stringify(batch)
    const baseline = assessPrivateM3RetailerIngestion(rights, batch,
      { referenceTime: AT })
    const shifted = reordered(batch, mode)
    const shiftedBefore = JSON.stringify(shifted)
    const actual = assessPrivateM3RetailerIngestion(rights, shifted,
      { referenceTime: AT })
    verifyPrivateNoRelease(baseline)
    verifyPrivateNoRelease(actual)
    // The same six physical source events, not the transport/order in which
    // they happened to be listed, determine historical facts and decisions.
    assert.deepEqual(actual, baseline)
    assert.equal(JSON.stringify(rights), beforeRights)
    assert.equal(JSON.stringify(batch), beforeBatch)
    assert.equal(JSON.stringify(shifted), shiftedBefore)
  })
}

test('repeated private six-source assessment is deterministic and side-effect free', async () => {
  const { rights, batch } = await canonicalInputs()
  const initial = assessPrivateM3RetailerIngestion(rights, batch, { referenceTime: AT })
  for (let i = 0; i < 4; i++) {
    const subsequent = assessPrivateM3RetailerIngestion(rights, batch,
      { referenceTime: AT })
    assert.deepEqual(subsequent, initial)
  }
})
