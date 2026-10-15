import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// Independent quality-validation of the public offline M3 comparator at its
// documented 500-recipe limit. All products/prices/sources below are fictional.
// No real retailer network, scrape, consent or public savings claim.
const NOW = Date.parse('2026-10-15T10:00:00.000Z')
const PRICE = { plus: 129, dekamarkt: 75 }
const SHOPS = ['plus', 'dekamarkt']

const observation = (shop, stock = 'available') => ({
  supermarket: shop,
  sourceProductId: 'fictional-halfvolle-milk-' + shop,
  name: 'Halfvolle melk',
  currentPriceCents: PRICE[shop],
  currency: 'EUR',
  pack: {
    amount: shop === 'plus' ? 1000 : 500,
    unit: 'ml', rawText: shop === 'plus' ? '1 l' : '500 ml',
  },
  availability: stock,
  offer: null,
  provenance: {
    supermarket: shop, kind: 'product',
    url: shop === 'plus'
      ? 'https://www.plus.nl/product/fictional-halfvolle-milk'
      : 'https://www.dekamarkt.nl/producten/fictional-halfvolle-milk',
    capturedAt: '2026-10-15T09:00:00.000Z', sha256: 'd'.repeat(64),
  },
})

const requirements = (count, amount) => Array.from({ length: count }, (_, i) => ({
  id: 'meal-' + i, query: 'halfvolle melk', amount, unit: 'ml',
}))

function compare(demands, observations = SHOPS.map(shop => observation(shop))) {
  const original = JSON.stringify({ demands, observations })
  const result = compareReviewedCatalogs({
    requirements: demands, observations, nowMs: NOW,
  })
  assert.equal(JSON.stringify({ demands, observations }), original,
    'no direct mutation of planner demand or reviewed source observations')
  assert.equal(result.provenance, 'offline-snapshot-preview')
  assert.equal(result.claimable, false)
  return result
}

// Hand-computed test vectors: ceil(sum of ORIGINAL decimal recipe demand /
// physical pack amount), never calling the product implementation as oracle.
const CASES = [
  { count: 1, amount: 1, plusPacks: 1, dekaPacks: 1 },
  { count: 125, amount: 4, plusPacks: 1, dekaPacks: 1 },
  { count: 250, amount: 4, plusPacks: 1, dekaPacks: 2 },
  { count: 499, amount: 2, plusPacks: 1, dekaPacks: 2 },
  { count: 500, amount: 2, plusPacks: 1, dekaPacks: 2 },
  { count: 500, amount: 2.000001, plusPacks: 2, dekaPacks: 3 },
  { count: 500, amount: 4, plusPacks: 2, dekaPacks: 4 },
  { count: 500, amount: 0.000001, plusPacks: 1, dekaPacks: 1 },
]

for (const record of CASES) {
  for (const reverse of [false, true]) {
    test('independent maximal recipe pooling: ' + record.count +
      ' × ' + record.amount + ' ml, reverse=' + reverse, () => {
      const demand = requirements(record.count, record.amount)
      if (reverse) demand.reverse()
      const result = compare(demand)
      const plusTotal = record.plusPacks * PRICE.plus
      const dekaTotal = record.dekaPacks * PRICE.dekamarkt
      const delta = dekaTotal - plusTotal
      assert.equal(result.comparable, true)
      assert.equal(result.lines.length, record.count)
      assert.equal(result.stores.plus.subtotalCents, plusTotal)
      assert.equal(result.stores.dekamarkt.subtotalCents, dekaTotal)
      assert.equal(result.cheaperStore,
        delta > 0 ? 'plus' : delta < 0 ? 'dekamarkt' : 'equal')
      assert.equal(result.savingsCents, Math.abs(delta))
      assert.equal(result.lines[0].differenceCents, delta)
      assert.deepEqual(
        result.lines[0].plus.sharedPackCoversIngredientIds ?? [demand[0].id],
        demand.map(row => row.id),
      )
      assert.deepEqual(
        result.lines[0].dekamarkt.sharedPackCoversIngredientIds ?? [demand[0].id],
        demand.map(row => row.id),
      )
      for (const shop of SHOPS) {
        assert.equal(result.lines[0][shop].packs,
          shop === 'plus' ? record.plusPacks : record.dekaPacks)
        assert.equal(result.lines[0][shop].totalCents,
          shop === 'plus' ? plusTotal : dekaTotal)
        for (const line of result.lines.slice(1)) {
          assert.equal(line[shop].packs, 0)
          assert.equal(line[shop].totalCents, 0)
          assert.equal(line[shop].sharedPackWithIngredientId, demand[0].id)
          assert.equal(line.differenceCents, 0)
        }
      }
    })
  }
}

for (const unknownShop of SHOPS) {
  test('500 physical recipe lines cannot claim full basket with ' +
    unknownShop + ' stock unknown', () => {
    const demands = requirements(500, 2)
    const observed = SHOPS.map(shop =>
      observation(shop, shop === unknownShop ? 'unknown' : 'available'))
    const r = compare(demands, observed)
    assert.equal(r.comparable, false)
    assert.equal(r.cheaperStore, null)
    assert.equal(r.savingsCents, null)
    assert.equal(r.stores[unknownShop].complete, false)
    assert.equal(r.lines[0][unknownShop].status, 'availability_unknown')
    assert.equal(r.lines[0][unknownShop].sharedPackCoversIngredientIds.length, 500)
    for (const line of r.lines) {
      assert.equal(line.differenceCents, null)
      assert.equal(line[unknownShop].status, 'availability_unknown')
    }
  })
}

test('the public comparison input cap rejects 501 distinct requirements before any financial result', () => {
  assert.throws(() => compareReviewedCatalogs({
    requirements: requirements(501, 1),
    observations: SHOPS.map(shop => observation(shop)),
    nowMs: NOW,
  }), /Invalid comparison input/)
})

test('one unresolved recipe at the 500-line boundary must not leave a fictitious full winner', () => {
  const demand = requirements(500, 2)
  demand[499] = { ...demand[499], amount: null }
  const r = compare(demand)
  assert.equal(r.comparable, false)
  assert.equal(r.cheaperStore, null)
  assert.equal(r.savingsCents, null)
  assert.equal(r.lines[499].plus.status, 'unknown')
  assert.equal(r.lines[499].dekamarkt.status, 'unknown')
  assert.equal(r.lines[499].differenceCents, null)
  assert.equal(r.lines[0].plus.sharedPackCoversIngredientIds.length, 499)
  assert.equal(r.lines[0].dekamarkt.sharedPackCoversIngredientIds.length, 499)
})

test('10001 source records are rejected at input preflight, not silently truncated', () => {
  assert.throws(() => compareReviewedCatalogs({
    requirements: requirements(1, 1),
    observations: Array(10001).fill({}),
    nowMs: NOW,
  }), /Invalid comparison input/)
})
