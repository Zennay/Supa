import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRawProductObservation } from '../src/data/ingestion.ts'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// Independent QA for the *direct* RawProductObservation ingestion contract.
// The dedicated HTML product parsers already guard retailer product routes;
// these synthetic normalized raw records intentionally bypass those parsers.
// Do not accept same-host login/search pages as a price-bearing product source.
const NOW = Date.parse('2026-10-15T10:00:00Z')
const req = [{ id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' }]
const origins = {
  plus: 'https://www.plus.nl',
  dekamarkt: 'https://www.dekamarkt.nl',
}
const productRoutes = {
  plus: '/product/fictional-milk',
  dekamarkt: '/producten/fictional-milk',
}

function observation(shop, cents, suffix = productRoutes[shop]) {
  return {
    supermarket: shop,
    sourceProductId: 'fictional-milk-' + shop,
    name: 'Halfvolle melk',
    currentPriceCents: cents,
    currency: 'EUR',
    pack: { amount: 1000, unit: 'ml', rawText: '1 l' },
    offer: null,
    availability: 'available',
    provenance: {
      supermarket: shop,
      kind: 'product',
      url: origins[shop] + suffix,
      capturedAt: '2026-10-15T09:00:00Z',
      sha256: 'b'.repeat(64),
    },
  }
}

function compare(shop, suffix) {
  const rows = [
    observation('plus', 129, shop === 'plus' ? suffix : undefined),
    observation('dekamarkt', 119, shop === 'dekamarkt' ? suffix : undefined),
  ]
  const before = JSON.stringify(rows)
  const result = compareReviewedCatalogs({
    requirements: req,
    observations: rows,
    nowMs: NOW,
  })
  assert.equal(JSON.stringify(rows), before, 'raw source evidence must remain immutable')
  assert.equal(result.claimable, false)
  return result
}

test('control: normal product-route evidence produces fictional two-pack comparison', () => {
  for (const shop of ['plus', 'dekamarkt']) {
    const record = observation(shop, 119)
    assert.equal(validateRawProductObservation(record), record)
  }
  const result = compare('plus', productRoutes.plus)
  assert.equal(result.comparable, true)
  assert.equal(result.cheaperStore, 'dekamarkt')
  assert.equal(result.savingsCents, 20)
  assert.equal(result.lines[0].plus.totalCents, 258)
  assert.equal(result.lines[0].dekamarkt.totalCents, 238)
})

for (const shop of ['plus', 'dekamarkt']) {
  for (const [label, pathname] of [
    ['account route', '/account/login'],
    ['search masquerading as product', '/search?q=fictional-milk'],
  ]) {
    test('expected RED raw source guard: ' + shop + ' ' + label, () => {
      assert.throws(() => validateRawProductObservation(observation(shop, 119, pathname)),
        /provenance|route|product|URL|source/i)
    })
    test('expected RED direct price claim: ' + shop + ' ' + label, () => {
      const result = compare(shop, pathname)
      assert.equal(result.comparable, false)
      assert.equal(result.cheaperStore, null)
      assert.equal(result.savingsCents, null)
      assert.equal(result.reason, 'invalid_or_stale_source')
      assert.equal(result.lines[0][shop].sourceUrl, null)
    })
  }
}
