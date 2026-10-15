import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { ingestReviewedBatch, loadReviewedRepositoryFixtures,
  RETAILER_REVIEWED_FIXTURES } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { planPrivateRetailerRollout, main } from
  '../scripts/retailer-private-source-rollout-matrix.mjs'

const gateFile = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const initialClock = '2026-10-05T00:00:00.000Z'
const staleClock = '2026-10-15T20:00:00.000Z'
const gate = () => readFile(gateFile, 'utf8').then(JSON.parse)
const offline = () => loadReviewedRepositoryFixtures()

test('rollout: actual six PLUS/Deka historical shapes are reviewable, not licensed live', async () => {
  const report = planPrivateRetailerRollout(await gate(), await offline(), {
    referenceTime: initialClock,
  })
  assert.equal(report.expectedShapeCount, 6)
  assert.equal(report.historicalAcceptedShapes, 6)
  assert.equal(report.missingHistoricalShapeCount, 0)
  assert.equal(report.staleHistoricalCaptures, 0)
  assert.deepEqual(report.retailers.map(x => x.retailerId), ['plus', 'dekamarkt'])
  assert.deepEqual(report.retailers.map(x => x.permissionStatus),
    ['permission_required', 'unresolved'])
  for (const retailer of report.retailers) {
    assert.deepEqual(retailer.shapes.map(x => x.kind), ['product', 'catalog', 'offers'])
    assert.equal(retailer.acceptedHistoricalShapes, 3)
    assert.equal(retailer.sourceRightsReadyForProduction, false)
    assert.equal(retailer.liveScrapingEnabled, false)
    assert.equal(retailer.scheduledRefreshEnabled, false)
    assert.equal(retailer.currentPricePublicationAllowed, false)
    assert.equal(retailer.nextActions[0], 'obtain-and-verify-retailer-source-rights')
    for (const shape of retailer.shapes) {
      assert.equal(shape.status, 'historical-fixture-present')
      assert.equal(shape.eligibleForLiveCapture, false)
      assert.equal(shape.verifiedCurrentPriceObservations, 0)
    }
  }
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.liveRetailerRequests, 0)
  assert.equal(report.permissionVerifiedForNewCapture, false)
  assert.equal(report.rightsGateProductionReady, false)
})

test('rollout: ageing authentic captures never becomes current price coverage', async () => {
  const report = planPrivateRetailerRollout(await gate(), await offline(), {
    referenceTime: staleClock,
  })
  assert.equal(report.staleHistoricalCaptures, 6)
  for (const retailer of report.retailers) {
    assert.equal(retailer.nextActions.includes('review-historical-capture-freshness'), true)
    for (const shape of retailer.shapes) {
      assert.equal(shape.status, 'archived-capture-outside-review-window')
      assert.equal(shape.staleHistoricalCaptures, 1)
      assert.equal(shape.eligibleForLiveCapture, false)
    }
  }
})

test('rollout: missing one historic source must be actionable, not passed as six-shape', async () => {
  const records = await Promise.all(RETAILER_REVIEWED_FIXTURES.slice(0, -1)
    .map(file => readFile(new URL('../fixtures/m1/' + file, import.meta.url), 'utf8')
      .then(JSON.parse)))
  const report = planPrivateRetailerRollout(await gate(), ingestReviewedBatch(records), {
    referenceTime: initialClock,
  })
  assert.equal(report.expectedShapeCount, 6)
  assert.equal(report.historicalAcceptedShapes, 5)
  assert.equal(report.missingHistoricalShapeCount, 1)
  const deka = report.retailers[1]
  assert.equal(deka.shapes[2].kind, 'offers')
  assert.equal(deka.shapes[2].status, 'no-accepted-historical-capture')
  assert.equal(deka.nextActions.includes('review-missing-offline-source-shapes'), true)
  assert.equal(report.productionEnabled, false)
})

test('rollout: invalid rights or forged adapter summary never yields an operator matrix', async () => {
  const rights = await gate()
  const batch = await offline()
  rights.sources[0].permissionStatus = 'permitted'
  rights.sources[0].productionEnabled = true
  assert.throws(() => planPrivateRetailerRollout(rights, batch, {
    referenceTime: initialClock,
  }))
  const valid = await gate()
  const forged = structuredClone(batch)
  forged.summary.acceptedSources = 700
  assert.throws(() => planPrivateRetailerRollout(valid, forged, {
    referenceTime: initialClock,
  }))
  assert.throws(() => planPrivateRetailerRollout(valid, batch, {
    referenceTime: 'not-an-instant',
  }))
})

test('rollout: exported CLI uses bundled fixtures and writes only aggregate safe metadata', async () => {
  let output = ''
  const report = await main(['--at', initialClock], text => { output += text })
  assert.deepEqual(JSON.parse(output), report)
  assert.equal(output.includes('https://www.plus.nl'), false)
  assert.equal(output.includes('https://www.dekamarkt.nl'), false)
  assert.equal(output.includes('579010'), false)
  assert.equal(output.includes('115873'), false)
  assert.equal(output.includes('currentPriceCents'), false)
  for (const bad of [['--dir', '/tmp'], ['--at', 'tomorrow'], ['--at'],
    ['--at', initialClock, '--fetch'], ['--fetch']]) {
    await assert.rejects(() => main(bad))
  }
})

test('rollout: rejected extra PLUS sample needs human review, even beside an accepted sample', async () => {
  const records = await Promise.all(RETAILER_REVIEWED_FIXTURES.map(file =>
    readFile(new URL('../fixtures/m1/' + file, import.meta.url), 'utf8').then(JSON.parse)))
  const rejected = structuredClone(records[0])
  rejected.source.id += '-rejected'
  rejected.browserEvidence.safety.antiBotBypass = true
  const report = planPrivateRetailerRollout(await gate(), ingestReviewedBatch([...records, rejected]), {
    referenceTime: initialClock,
  })
  assert.equal(report.historicalAcceptedShapes, 6)
  assert.equal(report.retailers[0].shapes[0].rejectedSources, 1)
  assert.equal(report.retailers[0].shapes[0].status, 'rejected-historical-input-needs-review')
  assert.equal(report.retailers[0].nextActions.includes('review-rejected-adapter-evidence'), true)
  assert.equal(report.productionEnabled, false)
})
