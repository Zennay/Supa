import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// Independent QA on the latest integrated M3 source. Everything is fictional,
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


// Full-basket counterpart to the single-product availability lattice above.
// One missing stock assertion, anywhere among 11 PLUS + 11 DekaMarkt prices,
// must withhold the *entire* store comparison, even when other 21 lines match.
// These are explicitly fictional grocery SKUs, never genuine field evidence.
const basketNames = [
  'avocado', 'amandelmelk', 'bloemkool', 'champignon', 'edamame',
  'fusilli', 'havermout', 'kikkererwten', 'linzen', 'olijfolie', 'pindakaas',
]
const basketRequirements = basketNames.map((query, index) => ({
  id: 'stock-demand-' + index,
  query,
  amount: 1000,
  unit: 'g',
}))

function syntheticFullBasket() {
  return basketNames.flatMap((name, index) => ['plus', 'dekamarkt'].map(shop => ({
    supermarket: shop,
    sourceProductId: 'fictional-basket-' + index,
    name,
    currentPriceCents: shop === 'plus' ? 125 + index : 115 + index,
    currency: 'EUR',
    pack: { rawText: '500 g', amount: 500, unit: 'g' },
    availability: 'available',
    offer: null,
    provenance: {
      supermarket: shop,
      kind: 'product',
      url: shop === 'plus'
        ? 'https://www.plus.nl/product/fictional-' + index
        : 'https://www.dekamarkt.nl/producten/fictional-' + index,
      capturedAt: '2026-10-15T09:00:00Z',
      sha256: (index + 1).toString(16).padStart(64, '0'),
    },
  })))
}

function compareFullBasket(rows) {
  return compareReviewedCatalogs({
    requirements: basketRequirements,
    observations: rows,
    nowMs: NOW,
  })
}

test('control: every one of 22 fictional in-stock lines yields exact 220-cent full basket gap', () => {
  const rows = syntheticFullBasket()
  const before = JSON.stringify(rows)
  const result = compareFullBasket(rows)
  assert.equal(result.lines.length, 11)
  assert.equal(result.comparable, true)
  assert.equal(result.cheaperStore, 'dekamarkt')
  assert.equal(result.savingsCents, 220)
  assert.equal(result.claimable, false)
  assert.equal(JSON.stringify(rows), before)
})

test('22 exhaustive positions: one unconfirmed stock observation blocks the entire basket', async t => {
  for (let position = 0; position < 22; position += 1) {
    await t.test('unknown stock at physical observed line ' + (position + 1), () => {
      const rows = syntheticFullBasket()
      rows[position].availability = 'unknown'
      const before = JSON.stringify(rows)
      const result = compareFullBasket(rows)
      assert.equal(result.lines.length, 11)
      assert.equal(result.comparable, false)
      assert.equal(result.cheaperStore, null)
      assert.equal(result.savingsCents, null)
      assert.equal(result.claimable, false)
      assert.equal(result.lines[Math.floor(position / 2)]
        [position % 2 === 0 ? 'plus' : 'dekamarkt'].status,
        'availability_unknown')
      assert.equal(JSON.stringify(rows), before)
    })
  }
})
