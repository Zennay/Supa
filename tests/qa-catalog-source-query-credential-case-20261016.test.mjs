import assert from 'node:assert/strict'
import test from 'node:test'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Independent private M3 QA. Tokens are inert fictional markers in a detached
// historical fixture-shaped URL. Never fetch, print, log or request retailer
// resources: the source is an offline archived source-provenance contract.
async function onePrivateRetailerBatch(query) {
  const historic = await loadReviewedRepositoryFixtures()
  const source = structuredClone(historic.results.find(r => r.key === 'plus:product'))
  assert.ok(source?.observations?.length)
  source.observations = [source.observations[0]]
  const observation = source.observations[0]
  const url = new URL(observation.provenance.url)
  url.search = query
  observation.provenance.url = url.toString()
  return { summary: { mode: 'reviewed-offline-only' }, results: [source] }
}

const untrusted = /untrusted|refus|credential|source URL/i
function assertPrivateOnly(catalog) {
  assert.equal(catalog.status, 'private-review-only')
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  for (const product of catalog.products) {
    assert.equal(product.sourceRightsVerified, false)
    assert.equal(product.publishable, false)
    assert.equal(product.currentTrustedPriceCents, null)
  }
}

test('control: archived PLUS fixture-shaped safe source query remains strictly private', async () => {
  const batch = await onePrivateRetailerBatch('?filter=historical')
  const catalog = buildUniversalRetailerCatalog(batch)
  assert.equal(catalog.sourceCount, 1)
  assertPrivateOnly(catalog)
})

test('control: existing lowercase access_token query is refused before catalog publication', async () => {
  const batch = await onePrivateRetailerBatch('?access_token=synthetic-marker')
  assert.throws(() => buildUniversalRetailerCatalog(batch), untrusted)
})

for (const [label, query] of [
  ['uppercase access_token', '?ACCESS_TOKEN=synthetic-marker'],
  ['mixed-case access_token', '?Access_Token=synthetic-marker'],
  ['percent-encoded query name case', '?%41CCESS_TOKEN=synthetic-marker'],
]) {
  test('source URL must refuse ' + label + ' without accepting credential facts [EXPECTED RED]', async () => {
    const batch = await onePrivateRetailerBatch(query)
    assert.throws(() => buildUniversalRetailerCatalog(batch), untrusted)
  })
}
