import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// Independent QA for direct M3 reviewed-catalog input. Everything is fictional,
// offline and permission-neutral: no retailer HTTP, shoppers or observed prices.
// Price-known is NOT stock-known. 'unknown' must not become 'available'.
const NOW = Date.parse('2026-10-15T10:00:00Z')
const requirements = [{ id: 'milk', query: 'halfvolle melk', amount: 1500, unit: 'ml' }]

function item(shop, cents, availability = 'available') {
  return {
    supermarket: shop,
    sourceProductId: 'fictional-milk-' + shop,
    name: 'Halfvolle melk',
    currentPriceCents: cents,
    currency: 'EUR',
    pack: { rawText: '1 l', amount: 1000, unit: 'ml' },
    offer: null,
    availability,
    provenance: {
      supermarket: shop,
      kind: 'product',
      url: shop === 'plus'
        ? 'https://www.plus.nl/product/fictional-stock'
        : 'https://www.dekamarkt.nl/producten/fictional-stock',
      capturedAt: '2026-10-15T09:00:00Z',
      sha256: 'e'.repeat(64),
    },
  }
}

function compare(plusAvailability, dekaAvailability, plusPrice = 129, dekaPrice = 119) {
  const observations = [
    item('plus', plusPrice, plusAvailability),
    item('dekamarkt', dekaPrice, dekaAvailability),
  ]
  const before = JSON.stringify(observations)
  const result = compareReviewedCatalogs({ requirements, observations, nowMs: NOW })
  assert.equal(JSON.stringify(observations), before, 'comparison cannot mutate provenance')
  assert.equal(result.provenance, 'offline-snapshot-preview')
  assert.equal(result.claimable, false)
  return result
}

function noWinner(result) {
  assert.equal(result.comparable, false, 'uncertain availability cannot yield a full basket winner')
  assert.equal(result.cheaperStore, null)
  assert.equal(result.savingsCents, null)
  assert.equal(result.stores.plus.complete && result.stores.dekamarkt.complete, false)
}

test('control: both observed in stock preserve exact two-pack fictional baseline', () => {
  const r = compare('available', 'available')
  assert.equal(r.comparable, true)
  assert.equal(r.cheaperStore, 'dekamarkt')
  assert.equal(r.savingsCents, 20)
  assert.equal(r.lines[0].plus.totalCents, 258)
  assert.equal(r.lines[0].dekamarkt.totalCents, 238)
})

test('control: genuine known zero-cent checkout still requires known stock', () => {
  const r = compare('available', 'available', 0, 119)
  assert.equal(r.comparable, true)
  assert.equal(r.cheaperStore, 'plus')
  assert.equal(r.savingsCents, 238)
})

test('control: explicitly unavailable inventory cannot win', () => {
  noWinner(compare('available', 'unavailable'))
  noWinner(compare('unavailable', 'available'))
})

test('control: no price cannot establish a winner even when stock is unknown', () => {
  noWinner(compare('available', 'unknown', 129, null))
})

for (const [label, plusAvailability, dekaAvailability, plusPrice, dekaPrice] of [
  ['lower priced Deka has unknown stock', 'available', 'unknown', 129, 119],
  ['baseline PLUS has unknown stock', 'unknown', 'available', 129, 119],
  ['both shops have unknown stock', 'unknown', 'unknown', 129, 119],
  ['free PLUS pack has unknown stock', 'unknown', 'available', 0, 119],
  ['equal-price shops include unknown stock', 'available', 'unknown', 119, 119],
]) {
  test('direct unknown-stock hold: ' + label, () => {
    noWinner(compare(plusAvailability, dekaAvailability, plusPrice, dekaPrice))
  })
}

test('control: invalid stock enum cannot be silently promoted to in-stock', () => {
  noWinner(compare('available', 'possibly-available'))
})

import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// Cross-layer proof: the normal offline JSON-LD adapter itself can parse a
// product's EUR checkout price when the retailer never asserts stock.
// No merchant network is contacted and no fictional prices are live data.
function parsedProduct(shop, cents, stockStatement) {
  const source = SOURCES.find((candidate) =>
    candidate.id === shop + '-product-halfvolle-melk')
  assert.ok(source, 'fixed offline source metadata exists for ' + shop)
  const offer = {
    '@type': 'Offer',
    price: (cents / 100).toFixed(2),
    priceCurrency: 'EUR',
  }
  if (stockStatement !== undefined) offer.availability = stockStatement
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    sku: 'fictional-unknown-inventory-' + shop,
    name: 'Halfvolle melk',
    weight: { value: '1000 ml' },
    offers: offer,
  }) + '</script>'
  const parsed = parseOfflineRetailerSnapshot({
    source,
    html,
    capturedAt: '2026-10-15T09:00:00.000Z',
  })
  assert.equal(parsed.observations.length, 1, 'normal adapter must emit this legitimate price record')
  assert.equal(parsed.observations[0].currentPriceCents, cents)
  return parsed.observations[0]
}

function compareParsed(plusStock, dekaStock) {
  const plus = parsedProduct('plus', 129, plusStock)
  const dekamarkt = parsedProduct('dekamarkt', 119, dekaStock)
  const observations = [plus, dekamarkt]
  const frozen = JSON.stringify(observations)
  const result = compareReviewedCatalogs({ requirements, observations, nowMs: NOW })
  assert.equal(JSON.stringify(observations), frozen)
  assert.equal(result.claimable, false)
  return { result, plus, dekamarkt }
}

test('cross-layer control: explicit Schema.org InStock maintains fictional two-store preview', () => {
  const { result, plus, dekamarkt } = compareParsed(
    'https://schema.org/InStock', 'https://schema.org/InStock')
  assert.equal(plus.availability, 'available')
  assert.equal(dekamarkt.availability, 'available')
  assert.equal(result.comparable, true)
  assert.equal(result.cheaperStore, 'dekamarkt')
  assert.equal(result.savingsCents, 20)
})

for (const [label, plusStock, dekaStock] of [
  ['Deka Offer omits availability', 'https://schema.org/InStock', undefined],
  ['PLUS Offer omits availability', undefined, 'https://schema.org/InStock'],
  ['Deka Offer uses an unrelated InStock URL', 'https://schema.org/InStock', 'https://example.invalid/InStock'],
]) {
  test('cross-layer missing stock holds: ' + label, () => {
    const { result, plus, dekamarkt } = compareParsed(plusStock, dekaStock)
    assert.equal(plus.availability === 'unknown' || dekamarkt.availability === 'unknown', true)
    noWinner(result)
  })
}


/**
 * Full paired retailer availability lattice on the *integrated* M3 source.
 * For any three-state pair, an all-known physical basket winner exists IFF
 * both shops have explicitly confirmed availability. Run with multiple price
 * directions, zero prices and ties to keep pricing independent of stock.
 */
for (const [plusPrice, dekaPrice, label] of [
  [129, 119, 'Deka appears cheaper'],
  [119, 129, 'PLUS appears cheaper'],
  [119, 119, 'equal unit prices'],
  [0, 0, 'free unit price at both shops'],
]) {
  test('exhaustive 3x3 availability pairs: ' + label, async (t) => {
    for (const plusAvailability of ['available', 'unavailable', 'unknown']) {
      for (const dekaAvailability of ['available', 'unavailable', 'unknown']) {
        await t.test(plusAvailability + ' vs ' + dekaAvailability, () => {
          const result = compare(
            plusAvailability, dekaAvailability, plusPrice, dekaPrice)
          if (plusAvailability !== 'available' || dekaAvailability !== 'available') {
            noWinner(result)
            return
          }
          assert.equal(result.comparable, true)
          assert.equal(result.cheaperStore, dekaPrice < plusPrice ? 'dekamarkt'
            : dekaPrice > plusPrice ? 'plus' : 'equal')
          assert.equal(result.savingsCents, 2 * Math.abs(dekaPrice - plusPrice))
        })
      }
    }
  })
}

test('raw observation ordering cannot upgrade unknown Deka stock to a winner', () => {
  const rows = [item('plus', 129, 'available'), item('dekamarkt', 119, 'unknown')]
  for (const ordered of [rows, [...rows].reverse()]) {
    const inputBefore = JSON.stringify(ordered)
    const r = compareReviewedCatalogs({ requirements, observations: ordered, nowMs: NOW })
    noWinner(r)
    assert.equal(r.lines[0].dekamarkt.status, 'availability_unknown')
    assert.equal(JSON.stringify(ordered), inputBefore)
  }
})

test('control: swapping independent retailer record order preserves known-stock prices', () => {
  const rows = [item('plus', 129, 'available'), item('dekamarkt', 119, 'available')]
  for (const ordered of [rows, [...rows].reverse()]) {
    const r = compareReviewedCatalogs({ requirements, observations: ordered, nowMs: NOW })
    assert.equal(r.comparable, true)
    assert.equal(r.cheaperStore, 'dekamarkt')
    assert.equal(r.savingsCents, 20)
    assert.equal(r.claimable, false)
  }
})
