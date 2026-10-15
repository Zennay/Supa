import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  proposePrivateCrossRetailerMatches, main,
} from '../scripts/retailer-private-cross-store-pairing.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

function setFacts(product, name, amount, unit) {
  const common = {
    name, currentPriceCents: 123, currency: 'EUR',
    pack: { rawText: 'reviewed mock package', amount, unit },
    offer: null, availability: 'unknown',
  }
  for (const capture of product.captures) Object.assign(capture, structuredClone(common))
  product.consistency = 'consistent'
}
async function pairCatalog() {
  const raw = buildUniversalRetailerCatalog(await loadReviewedRepositoryFixtures())
  const plus = structuredClone(raw.products.find(p => p.retailerId === 'plus'))
  const deka = structuredClone(raw.products.find(p => p.retailerId === 'dekamarkt'))
  assert.ok(plus && deka, 'historical fixtures must preserve both real adapters')
  setFacts(plus, 'Fictieve Halfvolle Melk', 1, 'l')
  setFacts(deka, 'halfvolle melk fictieve', 1000, 'ml')
  return {
    ...raw, products: [plus, deka],
    productCount: 2,
    captureCount: plus.captures.length + deka.captures.length,
    conflictCount: 0,
  }
}
describe('product: review-only physical pack cross-store candidate links', () => {
  it('matches reversed normalized word order and equivalent l↔ml packaging', async () => {
    const result = proposePrivateCrossRetailerMatches(await pairCatalog())
    assert.equal(result.candidateCount, 1)
    assert.equal(result.ambiguousGroups, 0)
    assert.equal(result.candidatePairs[0].status, 'human-review-required')
    assert.match(result.candidatePairs[0].plusProductKey, /^plus:/)
    assert.match(result.candidatePairs[0].dekamarktProductKey, /^dekamarkt:/)
    assert.equal(result.candidatePairs[0].verifiedEquivalent, false)
    assert.equal(result.candidatePairs[0].verifiedPriceMatch, false)
    assert.equal(result.candidatePairs[0].priceComparisonCents, null)
    assert.equal(result.productionEnabled, false)
    assert.equal(result.publicSavingsClaimEligible, false)
    assert.equal(result.permissionVerified, false)
    assert.equal(result.externalRequests, 0)
  })
  it('matches mass kg↔g but never mixes mass and volume', async () => {
    const catalog = await pairCatalog()
    setFacts(catalog.products[0], 'Fictief Bloem Wit', 1, 'kg')
    setFacts(catalog.products[1], 'Wit bloem fictief', 1000, 'g')
    assert.equal(proposePrivateCrossRetailerMatches(catalog).candidateCount, 1)
    setFacts(catalog.products[1], 'Wit bloem fictief', 1000, 'ml')
    assert.equal(proposePrivateCrossRetailerMatches(catalog).candidateCount, 0)
  })
  it('does not match different names or incompatible package sizes', async () => {
    const catalog = await pairCatalog()
    setFacts(catalog.products[1], 'Fictieve Volle Melk', 1000, 'ml')
    assert.equal(proposePrivateCrossRetailerMatches(catalog).candidateCount, 0)
    setFacts(catalog.products[1], 'Fictieve Halfvolle Melk', 500, 'ml')
    assert.equal(proposePrivateCrossRetailerMatches(catalog).candidateCount, 0)
  })
  it('does not infer physical equivalence from ambiguous pieces or packs', async () => {
    const catalog = await pairCatalog()
    for (const unit of ['piece', 'pack', 'unknown']) {
      setFacts(catalog.products[0], 'Fictieve Halfvolle Melk', 1, unit)
      assert.equal(proposePrivateCrossRetailerMatches(catalog).candidateCount, 0)
    }
    const report = proposePrivateCrossRetailerMatches(catalog)
    assert.equal(report.excluded.incomparablePackOrName.plus, 1)
  })
  it('does not pair one-word generic product labels', async () => {
    const catalog = await pairCatalog()
    for (const product of catalog.products) setFacts(product, 'Melk', 1, 'l')
    const report = proposePrivateCrossRetailerMatches(catalog)
    assert.equal(report.candidateCount, 0)
    assert.equal(report.excluded.incomparablePackOrName.plus, 1)
    assert.equal(report.excluded.incomparablePackOrName.dekamarkt, 1)
  })
  it('refuses ambiguous many-to-one cross-retailer identities', async () => {
    const catalog = await pairCatalog()
    const extra = structuredClone(catalog.products[0])
    extra.retailerProductId += '-duplicate'
    extra.canonicalKey = 'plus:' + extra.retailerProductId
    catalog.products.push(extra)
    catalog.productCount++
    catalog.captureCount += extra.captures.length
    const report = proposePrivateCrossRetailerMatches(catalog)
    assert.equal(report.candidateCount, 0)
    assert.equal(report.ambiguousGroups, 1)
    assert.equal(report.ambiguousProducts, 3)
  })
  it('refuses forged public claims and malformed source provenance', async () => {
    const original = await pairCatalog()
    for (const modify of [
      c => { c.products[0].publishable = true },
      c => { c.products[0].sourceRightsVerified = true },
      c => { c.publicSavingsClaimEligible = true },
      c => { c.products[0].captures[0].sourceUrl = 'https://example.com/item' },
      c => { c.products[0].captures[0].snapshotSha256 = 'not-a-valid-sha' },
      c => { c.productCount++ },
    ]) {
      const catalog = structuredClone(original)
      modify(catalog)
      assert.throws(() => proposePrivateCrossRetailerMatches(catalog), /refused/)
    }
  })
  it('excludes conflicting product histories instead of selecting a historical price', async () => {
    const catalog = await pairCatalog()
    const a = catalog.products[0]
    const extra = structuredClone(a.captures[0])
    extra.snapshotSha256 = 'f'.repeat(64)
    extra.currentPriceCents = 999
    a.captures.push(extra)
    a.consistency = 'review-required'
    catalog.captureCount++
    catalog.conflictCount = 1
    const report = proposePrivateCrossRetailerMatches(catalog)
    assert.equal(report.candidateCount, 0)
    assert.equal(report.excluded.conflictedHistory.plus, 1)
    assert.equal(report.verifiedEquivalentProducts, 0)
  })
  it('keeps candidate ordering and outputs deterministic on unchanged reviewed input', async () => {
    const catalog = await pairCatalog()
    assert.deepEqual(
      proposePrivateCrossRetailerMatches(catalog),
      proposePrivateCrossRetailerMatches(structuredClone(catalog)),
    )
  })
  it('CLI emits aggregate-only counts from real historical adapters without SKU IDs', async () => {
    let stdout = ''
    const report = await main([], text => { stdout += text })
    const decoded = JSON.parse(stdout)
    assert.equal(decoded.mode, 'private-cross-retailer-candidate-review')
    assert.equal(decoded.candidatePairs, undefined)
    assert.equal(report.candidatePairs, undefined)
    assert.equal(decoded.productionEnabled, false)
    assert.equal(decoded.priceComparisonsAvailable, false)
    assert.equal(decoded.externalRequests, 0)
    assert.equal(stdout.includes('www.plus.nl'), false)
    assert.equal(stdout.includes('www.dekamarkt.nl'), false)
  })
  it('CLI refuses unsupported args without stdout', async () => {
    let output = ''
    await assert.rejects(main(['--publish'], text => { output += text }), /refused/)
    assert.equal(output, '')
  })
})
