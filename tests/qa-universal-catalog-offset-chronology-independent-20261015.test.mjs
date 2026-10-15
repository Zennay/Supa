import assert from 'node:assert/strict'
import test from 'node:test'

import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Independent, offline-only QA: start from a real previously reviewed M1
// adapter observation, then create *fictional* timezone-format permutations.
// No store network, permission grant, live price or customer data is involved.
async function catalogFromTimes(older, newer, reverse = false) {
  const source = (await loadReviewedRepositoryFixtures()).results
    .find(result => result.key === 'plus:product')
  assert.ok(source?.accepted)
  const observations = [older, newer].map((capturedAt, index) => {
    const observation = structuredClone(source.observations[0])
    observation.provenance.capturedAt = capturedAt
    observation.provenance.sha256 = (index === 0 ? 'a' : 'b').repeat(64)
    return {
      key: 'plus:product',
      accepted: true,
      observations: [observation],
    }
  })
  const results = reverse ? observations.reverse() : observations
  return buildUniversalRetailerCatalog({
    summary: { mode: 'reviewed-offline-only' },
    results,
  })
}

function assertPrivateUnpromoted(catalog) {
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  assert.equal(catalog.products.length, 1)
  const product = catalog.products[0]
  assert.equal(product.sourceRightsVerified, false)
  assert.equal(product.publishable, false)
  assert.equal(product.currentTrustedPriceCents, null)
  assert.equal(product.selectedSnapshotSha256, null)
  assert.equal(product.captures.length, 2)
  return product.captures
}

test('positive: canonical UTC captures are ordered by physical captured instant with no price promotion', async () => {
  const older = '2026-10-14T10:00:00Z'
  const newer = '2026-10-14T10:15:00Z'
  for (const reversed of [false, true]) {
    const captures = assertPrivateUnpromoted(await catalogFromTimes(older, newer, reversed))
    assert.deepEqual(captures.map(c => c.capturedAt), [older, newer])
  }
})

test('expected RED: mixed +02:00 and Z capture offsets must not invert physical chronology', async () => {
  // 12:00 at +02:00 is 10:00 UTC: 15 minutes OLDER than 10:15Z.
  // Sorting the literal timestamp text instead of its absolute instant reverses them.
  const older = '2026-10-14T12:00:00+02:00'
  const newer = '2026-10-14T10:15:00Z'
  assert.ok(Date.parse(older) < Date.parse(newer))
  for (const reversed of [false, true]) {
    const captures = assertPrivateUnpromoted(await catalogFromTimes(older, newer, reversed))
    assert.deepEqual(captures.map(c => Date.parse(c.capturedAt)),
      [Date.parse(older), Date.parse(newer)],
      'retailer product captures must be sorted by physical instant, not display timezone')
  }
})

test('expected RED: mixed -04:00 and +02:00 offsets must retain newest physical capture last', async () => {
  // 14:00 +02:00 is 12:00 UTC; 08:30 -04:00 is 12:30 UTC.
  const older = '2026-10-14T14:00:00+02:00'
  const newer = '2026-10-14T08:30:00-04:00'
  assert.ok(Date.parse(older) < Date.parse(newer))
  for (const reversed of [false, true]) {
    const captures = assertPrivateUnpromoted(await catalogFromTimes(older, newer, reversed))
    assert.deepEqual(captures.map(c => Date.parse(c.capturedAt)),
      [Date.parse(older), Date.parse(newer)],
      'chronology must not change because an adapter retained an offset')
  }
})
