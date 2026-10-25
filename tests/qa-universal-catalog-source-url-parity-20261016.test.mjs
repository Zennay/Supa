import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { ingestReviewedBatch } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

// Independent QA only: do not touch original retailer observations on disk.
// All mutations below happen AFTER the strict six-adapter ingress succeeds,
// exercising the separately exported direct catalog trust boundary.
const HISTORICAL = [
  'plus-rendered-product-halfvolle-melk.v1.json',
  'dekamarkt-product-halfvolle-melk.v1.json',
]
async function acceptedHistoricalBatch() {
  const records = await Promise.all(HISTORICAL.map(async file =>
    JSON.parse(await readFile(new URL('../fixtures/m1/' + file, import.meta.url), 'utf8'))))
  const batch = ingestReviewedBatch(records)
  assert.equal(batch.summary.acceptedSources, 2)
  assert.equal(batch.summary.rejectedSources, 0)
  assert.equal(batch.summary.productionEnabled, false)
  assert.equal(batch.summary.permissionVerified, false)
  assert.equal(batch.summary.publicSavingsClaimEligible, false)
  return batch
}

test('unchanged PLUS and Deka historical observations remain a strictly private catalog', async () => {
  const catalog = buildUniversalRetailerCatalog(await acceptedHistoricalBatch())
  assert.equal(catalog.status, 'private-review-only')
  assert.equal(catalog.sourceCount, 2)
  assert.equal(catalog.productionEnabled, false)
  assert.equal(catalog.publicSavingsClaimEligible, false)
  assert.ok(catalog.products.length >= 2)
  for (const item of catalog.products) {
    assert.equal(item.sourceRightsVerified, false)
    assert.equal(item.publishable, false)
    assert.equal(item.currentTrustedPriceCents, null)
  }
})

// The product adapters now reject *any* query, fragment or URL downgrade.
// A direct consumer of the documented exported catalog constructor must not
// accidentally re-certify unreviewed URL identities after the adapter result
// object is mutated or supplied by a different programmatic caller.
for (const [label, transform] of [
  ['refresh-token query', url => url + '?refresh_token=FICTIONAL_NEVER_REAL'],
  ['ID-token query', url => url + '?id_token=FICTIONAL_NEVER_REAL'],
  ['authorization-code query', url => url + '?code=FICTIONAL_NEVER_REAL'],
  ['noncredential product query', url => url + '?unreviewed=1'],
  ['bare query delimiter', url => url + '?'],
  ['bare fragment delimiter', url => url + '#'],
  ['HTTP downgrade', url => url.replace(/^https:/, 'http:')],
  ['cross-retailer HTTPS source', (url, retailerIndex) => url.replace(
    retailerIndex === 0 ? 'www.plus.nl' : 'www.dekamarkt.nl',
    retailerIndex === 0 ? 'www.dekamarkt.nl' : 'www.plus.nl',
  )],
  ['untrusted HTTPS origin', url => url.replace(/^https:\/\/[^/]+/, 'https://unreviewed.invalid')],
  ['nonstandard HTTPS port', url => url.replace(/\.nl\//, '.nl:444/')],
]) {
  for (const retailerIndex of [0, 1]) {
    test('direct catalog refuses ' + label + ' in ' + (retailerIndex === 0 ? 'PLUS' : 'DekaMarkt') + ' product provenance', async () => {
      const batch = structuredClone(await acceptedHistoricalBatch())
      const result = batch.results[retailerIndex]
      const original = result.observations[0].provenance.url
      result.observations[0].provenance.url = transform(original, retailerIndex)
      assert.notEqual(result.observations[0].provenance.url, original)
      assert.throws(
        () => buildUniversalRetailerCatalog(batch),
        /Untrusted|unsafe|source URL|capture/i,
        'direct catalog must not certify a URL forbidden by the product source adapter',
      )
    })
  }
}

test('already rejected access_token query stays rejected in direct catalog', async () => {
  const batch = structuredClone(await acceptedHistoricalBatch())
  batch.results[0].observations[0].provenance.url += '?access_token=FICTIONAL_NEVER_REAL'
  assert.throws(() => buildUniversalRetailerCatalog(batch), /Untrusted|unsafe|source URL/i)
})
