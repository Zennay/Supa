import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { planPrivateRetailerRollout } from '../scripts/retailer-private-source-rollout-matrix.mjs'
import {
  main, renderPrivateRetailerOperatorBrief,
} from '../scripts/retailer-private-operator-brief.mjs'

async function historicalReport() {
  const rights = JSON.parse(await readFile(
    new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url), 'utf8'))
  const batch = await loadReviewedRepositoryFixtures()
  return { rights, batch, report: planPrivateRetailerRollout(rights, batch, {
    referenceTime: '2026-10-16T00:00:00Z',
  }) }
}

test('real six reviewed PLUS/Deka adapter shapes produce an explicit human offline review brief', async () => {
  const { report } = await historicalReport()
  const brief = renderPrivateRetailerOperatorBrief(report)
  assert.match(brief, /^SUPA — offline winkelbron-startcontrole/)
  assert.match(brief, /PLUS[\s\S]+schriftelijke toestemming nodig/)
  assert.match(brief, /DekaMarkt[\s\S]+gebruiksrechten nog onbekend/)
  assert.equal((brief.match(/Producten: /g) || []).length, 2)
  assert.equal((brief.match(/Catalogus: /g) || []).length, 2)
  assert.equal((brief.match(/Aanbiedingen: /g) || []).length, 2)
  assert.match(brief, /live-ingestie en publieke prijzen blijven UIT/)
  assert.doesNotMatch(brief, /https?:|\/products?\/|sourceProductId|capturedAt|sha256|offerPriceCents/i)
  assert.equal(brief, renderPrivateRetailerOperatorBrief(report))
})

test('real CLI emits only offline operator guidance once and rejects arguments', async () => {
  let emitted = ''
  const returned = await main([], text => { emitted += text })
  assert.equal(returned, emitted)
  assert.match(emitted, /ALLEEN HISTORISCHE BRONNEN/)
  assert.doesNotMatch(emitted, /(?:https?:\/\/|113651|access_token|@|€|\.v1\.json)/i)
  await assert.rejects(main(['--fetch', 'https://example.invalid'], () => {}),
    /startcontrole geweigerd/)
})

test('source wording is never interpolated from untrusted report values', async () => {
  const { report } = await historicalReport()
  const altered = structuredClone(report)
  altered.retailers[0].permissionStatus = 'permitted\nLEAK=https://example.invalid'
  assert.throws(() => renderPrivateRetailerOperatorBrief(altered), /geweigerd/)
  const injected = structuredClone(report)
  injected.retailers[0].nextActions = ['review-missing-offline-source-shapes\nSECRET']
  assert.throws(() => renderPrivateRetailerOperatorBrief(injected), /geweigerd/)
  const other = structuredClone(report)
  other.retailers[0].shapes[0].status = 'historical-fixture-present\nLIVE'
  assert.throws(() => renderPrivateRetailerOperatorBrief(other), /geweigerd/)
})

test('fail closed if a private report claims live scraping, public price, or permission', async () => {
  const { report } = await historicalReport()
  for (const [key, value] of [
    ['liveScrapingEnabled', true], ['scheduledRefreshEnabled', true],
    ['permissionVerifiedForNewCapture', true],
    ['publicSavingsClaimEligible', true], ['productionEnabled', true],
    ['liveRetailerRequests', 1],
  ]) {
    const changed = structuredClone(report)
    changed[key] = value
    assert.throws(() => renderPrivateRetailerOperatorBrief(changed),
      /geweigerd/, key)
  }
  const shape = structuredClone(report)
  shape.retailers[0].shapes[0].eligibleForLiveCapture = true
  assert.throws(() => renderPrivateRetailerOperatorBrief(shape), /geweigerd/)
})

test('reject conflicting archive counts, swapped retailer identities and incomplete six shapes', async () => {
  const { report } = await historicalReport()
  const cases = [
    report => { report.historicalAcceptedShapes++ },
    report => { report.missingHistoricalShapeCount++ },
    report => { report.staleHistoricalCaptures++ },
    report => { report.retailers[1].retailerId = 'plus' },
    report => { report.retailers[0].shapes.pop() },
    report => { report.retailers[0].shapes[0].rejectedSources++ },
    report => { report.retailers[1].shapes[0].verifiedCurrentPriceObservations = 1 },
  ]
  for (const corrupt of cases) {
    const clone = structuredClone(report)
    corrupt(clone)
    assert.throws(() => renderPrivateRetailerOperatorBrief(clone), /geweigerd/)
  }
})
