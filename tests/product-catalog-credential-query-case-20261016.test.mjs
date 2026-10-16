import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// No real access token, credentials, network fetch or publishable source here:
// each query is an inert fictional marker on a historical PLUS fixture shape.
async function sourceWithUrl(suffix) {
  const reviewed = await loadReviewedRepositoryFixtures()
  const row = structuredClone(reviewed.results.find(r => r.key === 'plus:product'))
  assert.ok(row?.accepted && row.observations.length)
  row.observations = [structuredClone(row.observations[0])]
  const original = new URL(row.observations[0].provenance.url)
  row.observations[0].provenance.url = original.origin + original.pathname + suffix
  return { summary: { mode: 'reviewed-offline-only' }, results: [row] }
}

test('mixed-case, percent-decoded and duplicated source access_token keys never enter the private catalog', async () => {
  const bad = [
    '?ACCESS_TOKEN=fictional',
    '?Access_Token=fictional',
    '?%41CCESS_TOKEN=fictional',
    '?%61ccess_token=fictional',
    '?filter=historical&ACCESS_TOKEN=fictional',
    '?access_token=fictional&filter=historical',
    '?filter=historical&Access_Token=',
    '?%61CCESS_%54OKEN=fictional',
  ]
  for (const suffix of bad) {
    const input = await sourceWithUrl(suffix)
    const snapshot = structuredClone(input)
    assert.throws(() => buildUniversalRetailerCatalog(input),
      /Untrusted retailer capture source URL/)
    assert.deepEqual(input, snapshot, 'fail-closed must not edit source bytes')
  }
})

test('innocent historical selector query survives without claiming licensed prices', async () => {
  for (const suffix of ['', '?filter=historical', '?category=offline&item=sample']) {
    const input = await sourceWithUrl(suffix)
    const output = buildUniversalRetailerCatalog(input)
    assert.equal(output.status, 'private-review-only')
    assert.equal(output.sourceCount, 1)
    assert.equal(output.productionEnabled, false)
    assert.equal(output.publicSavingsClaimEligible, false)
    for (const p of output.products) {
      assert.equal(p.publishable, false)
      assert.equal(p.sourceRightsVerified, false)
      assert.equal(p.currentTrustedPriceCents, null)
    }
  }
})

test('lookalike non-credential parameter names stay harmless without broad false positives', async () => {
  const input = await sourceWithUrl('?access_token_hint=historical&filter=offline')
  const output = buildUniversalRetailerCatalog(input)
  assert.equal(output.sourceCount, 1)
  assert.equal(output.productionEnabled, false)
  assert.equal(output.products[0].sourceRightsVerified, false)
})

test('existing lowercase access_token and URL fragment still refuse before exposing provenance', async () => {
  for (const suffix of ['?access_token=fictional', '#private', '?filter=history#secret']) {
    const input = await sourceWithUrl(suffix)
    assert.throws(() => buildUniversalRetailerCatalog(input),
      /Untrusted retailer capture source URL/)
  }
})
