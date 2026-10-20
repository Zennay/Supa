import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { proposePrivateCrossRetailerMatches } from '../scripts/retailer-private-cross-store-pairing.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { buildUniversalRetailerCatalog } from '../scripts/retailer-universal-catalog.mjs'

/**
 * Independent QA: metamorphic physical-pack oracles over genuine historical
 * PLUS/Deka capture envelopes. Only names, packages and fictional price
 * *controls* are changed in-memory; no external data or approved price claims.
 */
const original = buildUniversalRetailerCatalog(await loadReviewedRepositoryFixtures())
const originalPlus = original.products.find(x => x.retailerId === 'plus')
const originalDeka = original.products.find(x => x.retailerId === 'dekamarkt')
assert.ok(originalPlus && originalDeka)
let scenarioCount = 0

function syntheticReviewPair() {
  const products = [structuredClone(originalPlus), structuredClone(originalDeka)]
  return {
    ...original,
    products,
    productCount: 2,
    captureCount: products.reduce((n, p) => n + p.captures.length, 0),
    conflictCount: 0,
  }
}
function setUnverifiedFacts(product, { name, amount, unit, fictionalCents }) {
  const facts = {
    name, currentPriceCents: fictionalCents, currency: 'EUR',
    pack: { rawText: 'synthetic metric review only', amount, unit },
    offer: null, availability: 'unknown',
  }
  for (const capture of product.captures) Object.assign(capture, structuredClone(facts))
  product.consistency = 'consistent'
}
function verifyNonPublishing(result, count) {
  assert.equal(result.mode, 'private-cross-retailer-candidate-review')
  assert.equal(result.candidateCount, count)
  assert.equal(result.verifiedEquivalentProducts, 0)
  assert.equal(result.priceComparisonsAvailable, false)
  assert.equal(result.permissionVerified, false)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.externalRequests, 0)
  assert.equal(result.humanReviewRequired, true)
  for (const link of result.candidatePairs) {
    assert.equal(link.status, 'human-review-required')
    assert.equal(link.verifiedEquivalent, false)
    assert.equal(link.verifiedPriceMatch, false)
    assert.equal(link.priceComparisonCents, null)
    assert.match(link.plusProductKey, /^plus:/)
    assert.match(link.dekamarktProductKey, /^dekamarkt:/)
    assert.equal(JSON.stringify(link).includes('fictionalCents'), false)
  }
}
function prepare({
  amount, family, reverseUnits = false, reverseStoreRows = false,
  reverseWords = false, plusCents = 0, dekaCents = 999, notEqual = false,
}) {
  const catalog = syntheticReviewPair()
  const [major, minor] = family === 'mass' ? ['kg', 'g'] : ['l', 'ml']
  const sourceAmount = reverseUnits ? amount : amount / 1000
  const destinationAmount = reverseUnits ? amount / 1000 : amount
  const [sourceUnit, destinationUnit] = reverseUnits ? [minor, major] : [major, minor]
  const wordsA = reverseWords ? 'Melk Halfvolle Fictieve' : 'Fictieve Halfvolle Melk'
  const wordsB = reverseWords ? 'fictieve melk halfvolle' : 'halfvolle fictieve melk'
  setUnverifiedFacts(catalog.products[0], {
    name: wordsA, amount: sourceAmount, unit: sourceUnit, fictionalCents: plusCents,
  })
  setUnverifiedFacts(catalog.products[1], {
    name: wordsB, amount: destinationAmount + (notEqual ? (reverseUnits ? 0.001 : 1) : 0),
    unit: destinationUnit, fictionalCents: dekaCents,
  })
  if (reverseStoreRows) catalog.products.reverse()
  return catalog
}

describe('QA M3: independent metric cross-store match false-confidence oracle', () => {
  it('384 valid and near-miss metric g/kg/ml/l controls never imply price savings or verified equivalence', () => {
    const amounts = [1, 2, 5, 25, 50, 100, 125, 200, 250, 500, 1000, 1500]
    for (const amount of amounts) {
      for (const family of ['mass', 'volume']) {
        for (const reverseUnits of [false, true]) {
          for (const reverseStoreRows of [false, true]) {
            for (const reverseWords of [false, true]) {
              const input = { amount, family, reverseUnits, reverseStoreRows, reverseWords }
              const positive = proposePrivateCrossRetailerMatches(prepare(input))
              verifyNonPublishing(positive, 1)
              const negative = proposePrivateCrossRetailerMatches(prepare({ ...input, notEqual: true }))
              verifyNonPublishing(negative, 0)
              scenarioCount += 2
            }
          }
        }
      }
    }
  })

  it('192 independently reversed fictional-price permutations change no physical match result or public claim', () => {
    for (const amount of [1, 5, 25, 100, 500, 1000]) {
      for (const family of ['mass', 'volume']) {
        for (const reverseUnits of [false, true]) {
          for (const reverseWords of [false, true]) {
            for (const money of [[0, 999999], [999999, 0]]) {
              const base = {
                amount, family, reverseUnits, reverseWords,
                plusCents: money[0], dekaCents: money[1],
              }
              verifyNonPublishing(proposePrivateCrossRetailerMatches(prepare(base)), 1)
              verifyNonPublishing(proposePrivateCrossRetailerMatches(prepare({ ...base, reverseStoreRows: true })), 1)
              scenarioCount += 2
            }
          }
        }
      }
    }
  })

  it('48 ambiguous multi-product groups are never silently promoted to a verified recommendation', () => {
    for (const duplicateRetailer of ['plus', 'dekamarkt']) {
      for (const amount of [1, 5, 25, 100, 500, 1000]) {
        for (const family of ['mass', 'volume']) {
          for (const reverseUnits of [false, true]) {
            const catalog = prepare({ amount, family, reverseUnits })
            const index = catalog.products.findIndex(p => p.retailerId === duplicateRetailer)
            const duplicate = structuredClone(catalog.products[index])
            duplicate.retailerProductId += '-extra'
            duplicate.canonicalKey = duplicateRetailer + ':' + duplicate.retailerProductId
            catalog.products.push(duplicate)
            catalog.productCount++
            catalog.captureCount += duplicate.captures.length
            const result = proposePrivateCrossRetailerMatches(catalog)
            verifyNonPublishing(result, 0)
            assert.equal(result.ambiguousGroups, 1)
            assert.equal(result.ambiguousProducts, 3)
            scenarioCount++
          }
        }
      }
    }
  })

  it('24 incompatible product-name permutations remain unpaired, regardless of monetary controls', () => {
    for (const family of ['mass', 'volume']) {
      for (const amount of [1, 5, 25, 100, 500, 1000]) {
        for (const extra of ['anders', 'biologisch']) {
          const catalog = prepare({ amount, family })
          const victim = catalog.products.find(x => x.retailerId === 'dekamarkt')
          for (const cap of victim.captures) cap.name += ' ' + extra
          const result = proposePrivateCrossRetailerMatches(catalog)
          verifyNonPublishing(result, 0)
          scenarioCount++
        }
      }
    }
  })

  it('existing real multi-capture source disagreement is excluded rather than assigning any historical price winner', () => {
    const catalog = prepare({ amount: 1000, family: 'volume' })
    const product = catalog.products.find(p => p.retailerId === 'plus')
    const extra = structuredClone(product.captures[0])
    extra.snapshotSha256 = 'f'.repeat(64)
    extra.currentPriceCents = 77
    product.captures.push(extra)
    product.consistency = 'review-required'
    catalog.captureCount++
    catalog.conflictCount++
    const result = proposePrivateCrossRetailerMatches(catalog)
    verifyNonPublishing(result, 0)
    assert.equal(result.excluded.conflictedHistory.plus, 1)
    scenarioCount++
  })

  it('independent matrix executed ≥649 concrete inputs, with no retail HTTP or release', () => {
    assert.ok(scenarioCount >= 649, 'executed ' + scenarioCount + ' actual scenarios')
  })
})
