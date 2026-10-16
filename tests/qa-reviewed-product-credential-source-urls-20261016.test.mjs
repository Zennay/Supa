import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { ingestReviewedEvidence, ingestReviewedBatch } from '../scripts/retailer-reviewed-ingest-engine.mjs'

// Direct historical PRODUCT adapter QA, distinct from existing catalogue/offer
// URL canonicalization P2 #3394. All fake values/local fixtures. NO network,
// customer secrets, current prices, public publication or rights activation.
const SAMPLES = [
  ['plus', 'plus-rendered-product-halfvolle-melk.v1.json'],
  ['dekamarkt', 'dekamarkt-product-halfvolle-melk.v1.json'],
]

async function historic(name) {
  return JSON.parse(await readFile(new URL('../fixtures/m1/' + name, import.meta.url), 'utf8'))
}

function appendUnreviewedSourceSuffix(record, retailer, suffix) {
  // Keep all existing independent local corroboration metadata coherent so
  // this tests source URL admission, not a false positive from URL mismatch.
  record.source.url += suffix
  if (retailer === 'plus') {
    record.browserEvidence.finalUrl = record.source.url
    record.jsonLd.url = record.source.url
  } else {
    record.jsonLdProduct.offers.url = record.source.url
  }
  return record
}

test('checked-in historical product detail sources ingest only in private review mode', async () => {
  const records = await Promise.all(SAMPLES.map(([, f]) => historic(f)))
  const result = ingestReviewedBatch(records)
  assert.equal(result.summary.sources, 2)
  assert.equal(result.summary.acceptedSources, 2)
  assert.equal(result.summary.rejectedSources, 0)
  assert.equal(result.summary.productionEnabled, false)
  assert.equal(result.summary.permissionVerified, false)
  assert.equal(result.summary.publicSavingsClaimEligible, false)
})

for (const [retailer, filename] of SAMPLES) {
  for (const [label, suffix] of [
    ['OAuth credential-named query', '?access_token=FICTIONAL_DO_NOT_USE'],
    ['refresh token-named query', '?refresh_token=FICTIONAL_DO_NOT_USE'],
    ['unreviewed URL fragment', '#fictional-unreviewed-anchor'],
    ['bare query delimiter', '?'],
    ['bare fragment delimiter', '#'],
  ]) {
    test(retailer + ' product archive must refuse ' + label + ' in source identity', async () => {
      const record = appendUnreviewedSourceSuffix(await historic(filename), retailer, suffix)
      assert.equal(record.source.url.endsWith(suffix), true)
      const result = ingestReviewedEvidence(record)
      assert.equal(result.accepted, false, 'unreviewed URL suffix cannot be portable reviewed provenance')
      assert.deepEqual(result.observations, [])
    })
  }
}

test('synthetic two-retailer credential-named source suffixes cannot count as reviewed approved products', async () => {
  const records = await Promise.all(SAMPLES.map(async ([retailer, filename]) =>
    appendUnreviewedSourceSuffix(await historic(filename), retailer, '?access_token=FICTIONAL_DO_NOT_USE')))
  const result = ingestReviewedBatch(records)
  assert.equal(result.summary.acceptedSources, 0)
  assert.equal(result.summary.rejectedSources, 2)
  assert.equal(result.summary.observations, 0)
  assert.equal(result.summary.productionEnabled, false)
  assert.equal(result.summary.permissionVerified, false)
  assert.equal(result.summary.publicSavingsClaimEligible, false)
})
