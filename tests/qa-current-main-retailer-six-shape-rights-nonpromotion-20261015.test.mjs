import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { captureToPrivateSelectorReview } from '../scripts/retailer-approved-capture-selector-bridge.mjs'
import { planPrivateRetailerRollout } from '../scripts/retailer-private-source-rollout-matrix.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Independent post-merge main composition, no source edits, no retailer HTTP.
// Six versioned M1 fixture captures are HISTORICAL; they are not price or
// source-permission evidence. Any permissive cases below use FICTION ONLY.
const archivedAuditAt = '2026-10-05T00:00:00.000Z'
const captureAt = '2026-10-05T01:00:00.000Z'
const permissionFile = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const deniedScenarios = [
  ['plus', 'product', 'https://www.plus.nl/product/fictional-123'],
  ['plus', 'catalog', 'https://www.plus.nl/producten'],
  ['plus', 'offers', 'https://www.plus.nl/aanbiedingen'],
  ['dekamarkt', 'product', 'https://www.dekamarkt.nl/producten/fictional-123'],
  ['dekamarkt', 'catalog', 'https://www.dekamarkt.nl/producten/'],
  ['dekamarkt', 'offers', 'https://www.dekamarkt.nl/aanbiedingen'],
]
const storedGate = () => readFile(permissionFile, 'utf8').then(JSON.parse)
const scope = (supermarket, kind, url) => ({
  supermarket, kind, sourceUrl: url, reviewed: true,
  termsReviewed: true, robotsReviewed: true, noAntiBotBypass: true,
})
function transportCounter() {
  let count = 0
  return {
    fetchFn: async () => {
      count++
      return new Response('<article class="product-card">NO_REAL_DATA</article>', {
        status: 200, headers: { 'content-type': 'text/html' },
      })
    },
    count: () => count,
  }
}
function fakeRights(gate, permitted) {
  const copy = structuredClone(gate)
  for (const retailer of copy.sources) {
    if (!permitted.includes(retailer.supermarket)) continue
    retailer.permissionStatus = 'permitted'
    retailer.productionEnabled = true
    retailer.evidence.push({
      kind: 'written_permission',
      url: 'https://example.test/fictional-test-authorization-only',
      finding: 'FICTIONAL UNIT TEST, never a retailer license.',
    })
  }
  return copy
}

test('integrated main: all six historical reviewed shapes can be present but real store rights still deny every mock capture', async () => {
  const gate = await storedGate()
  const original = JSON.stringify(gate)
  const batch = await loadReviewedRepositoryFixtures()
  const report = planPrivateRetailerRollout(gate, batch, {
    referenceTime: archivedAuditAt,
  })
  assert.equal(report.expectedShapeCount, 6)
  assert.equal(report.historicalAcceptedShapes, 6)
  assert.equal(report.rightsGateProductionReady, false)
  assert.deepEqual(report.retailers.map(r => r.permissionStatus),
    ['permission_required', 'unresolved'])
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.productionEnabled, false)
  const transport = transportCounter()
  for (const [supermarket, kind, url] of deniedScenarios) {
    await assert.rejects(() => captureToPrivateSelectorReview({
      source: { supermarket, kind, url },
      permissionGate: gate,
      grant: scope(supermarket, kind, url),
      capturedAt: captureAt,
      fetchFn: transport.fetchFn,
    }), /Explicit retailer source permission required/u)
  }
  assert.equal(transport.count(), 0)
  assert.equal(JSON.stringify(gate), original, 'read-only audit must never promote rights')
  assert.equal(report.liveRetailerRequests, 0)
})

test('integrated main: passing historical rollout summary as source permission gate is refused BEFORE any transport', async () => {
  const gate = await storedGate()
  const offlineReport = planPrivateRetailerRollout(gate,
    await loadReviewedRepositoryFixtures(), { referenceTime: archivedAuditAt })
  // Even a caller-forged aggregate summary has no written source grants.
  const forgery = { ...offlineReport, rightsGateProductionReady: true,
    permissionVerifiedForNewCapture: true, productionEnabled: true }
  const transport = transportCounter()
  const [supermarket, kind, url] = deniedScenarios[1]
  for (const candidate of [offlineReport, forgery]) {
    await assert.rejects(() => captureToPrivateSelectorReview({
      source: { supermarket, kind, url },
      permissionGate: candidate, grant: scope(supermarket, kind, url),
      capturedAt: captureAt, fetchFn: transport.fetchFn,
    }))
  }
  assert.equal(transport.count(), 0)
})

test('integrated main: a fictional PLUS-only license cannot authorize DekaMarkt capture or public price/savings claims', async () => {
  const gate = fakeRights(await storedGate(), ['plus'])
  const report = planPrivateRetailerRollout(gate,
    await loadReviewedRepositoryFixtures(), { referenceTime: archivedAuditAt })
  assert.deepEqual(report.retailers.map(x => x.sourceRightsReadyForProduction),
    [true, false])
  assert.equal(report.rightsGateProductionReady, false)
  assert.equal(report.permissionVerifiedForNewCapture, false)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  const transport = transportCounter()
  for (const [supermarket, kind, url] of deniedScenarios.filter(x => x[0] === 'dekamarkt')) {
    await assert.rejects(() => captureToPrivateSelectorReview({
      source: { supermarket, kind, url },
      permissionGate: gate, grant: scope(supermarket, kind, url),
      capturedAt: captureAt, fetchFn: transport.fetchFn,
    }), /Explicit retailer source permission required/u)
  }
  assert.equal(transport.count(), 0)
})

test('integrated main: even two fictional licensed retailers + six archives do not publish current prices', async () => {
  const gate = fakeRights(await storedGate(), ['plus', 'dekamarkt'])
  const report = planPrivateRetailerRollout(gate,
    await loadReviewedRepositoryFixtures(), { referenceTime: archivedAuditAt })
  assert.equal(report.rightsGateProductionReady, true)
  assert.equal(report.historicalAcceptedShapes, 6)
  assert.equal(report.permissionVerifiedForNewCapture, false)
  assert.equal(report.liveRetailerRequests, 0)
  assert.equal(report.productionEnabled, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  for (const retailer of report.retailers) {
    assert.equal(retailer.currentPricePublicationAllowed, false)
    assert.equal(retailer.scheduledRefreshEnabled, false)
    assert.equal(retailer.shapes.every(x => x.verifiedCurrentPriceObservations === 0), true)
  }
})
