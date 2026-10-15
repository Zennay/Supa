import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Independently pinned QA of DIRECT exported catalog API, not the source parser,
// CLI, database importer or an assertion about an actual retailer incident.
// Synthetic private records only. EXPECTED RED on source main ed3a396.
async function onePlusProduct() {
  const batch = await loadReviewedRepositoryFixtures()
  return structuredClone(batch.results.find(result => result.key === 'plus:product'))
}
const candidate = result => ({
  summary: { mode: 'reviewed-offline-only' },
  results: [result],
})

test('control: real bundled reviewed PLUS product can still produce a strictly private no-claim catalog', async () => {
  const source = await onePlusProduct()
  const report = buildUniversalRetailerCatalog(candidate(source))
  assert.ok(report.productCount > 0)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.productionEnabled, false)
  assert.ok(report.products.every(p =>
    p.currentTrustedPriceCents === null &&
    p.selectedSnapshotSha256 === null &&
    p.publishable === false &&
    p.sourceRightsVerified === false
  ))
})

test('direct universal catalog must refuse credential-bearing provenance URL (no source-secret echo)', async () => {
  const source = await onePlusProduct()
  source.observations[0].provenance.url = 'https://fake-user:FAKE_SECRET_DO_NOT_STORE@www.plus.nl/producten'
  assert.throws(
    () => buildUniversalRetailerCatalog(candidate(source)),
    /provenance|source|credential|URL|url|untrusted|refus/i,
    'a source URL with userinfo cannot enter a private provenance history',
  )
})

test('direct universal catalog must refuse captures dated well into the future', async () => {
  const source = await onePlusProduct()
  source.observations[0].provenance.capturedAt = '2035-01-01T12:00:00.000Z'
  assert.throws(
    () => buildUniversalRetailerCatalog(candidate(source)),
    /captur|timestamp|future|date|source|untrusted|refus/i,
    'future snapshots must not masquerade as already observed retailer evidence',
  )
})

test('direct universal catalog must reject imprecise integer-cent money outside JavaScript safe-integer range', async () => {
  const source = await onePlusProduct()
  source.observations[0].currentPriceCents = Number.MAX_SAFE_INTEGER + 1
  assert.throws(
    () => buildUniversalRetailerCatalog(candidate(source)),
    /price|cent|integer|money|untrusted|refus/i,
    'an integer exceeding 2^53-1 loses exact financial cent semantics',
  )
})
