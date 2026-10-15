import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// Fictional offline catalogue prices. Availability "unknown" is NOT
// confirmed stock, even if a non-null quote is present. Multiple planner
// ingredients must not show two independently rounded provisional packs.
const NOW = Date.parse('2026-10-15T10:00:00Z')
const split = [
  { id: 'breakfast', query: 'halfvolle melk', amount: 400, unit: 'ml' },
  { id: 'dinner', query: 'halfvolle melk', amount: 0.4, unit: 'l' },
]
function milk(shop, cents, availability) {
  return {
    supermarket: shop,
    sourceProductId: 'fictional-milk',
    name: 'Halfvolle melk',
    currentPriceCents: cents,
    currency: 'EUR',
    pack: { rawText: '1 l', amount: 1000, unit: 'ml' },
    offer: null, availability,
    provenance: {
      supermarket: shop, kind: 'product',
      url: shop === 'plus' ? 'https://www.plus.nl/product/fictional-milk'
        : 'https://www.dekamarkt.nl/producten/fictional-milk',
      capturedAt: '2026-10-15T09:00:00Z', sha256: 'a'.repeat(64),
    },
  }
}
function compare(plusStock, dekaStock, price = 119) {
  const observations = [milk('plus', 129, plusStock), milk('dekamarkt', price, dekaStock)]
  const prior = JSON.stringify({ requirements: split, observations })
  const result = compareReviewedCatalogs({ requirements: split, observations, nowMs: NOW })
  assert.equal(JSON.stringify({ requirements: split, observations }), prior)
  assert.equal(result.provenance, 'offline-snapshot-preview')
  assert.equal(result.claimable, false)
  return result
}

for (const [plus, deka, quotedDeka] of [
  ['available', 'unknown', 119],
  ['unknown', 'available', 119],
  ['unknown', 'unknown', 119],
  ['available', 'unknown', 129],
]) {
  test('M3 product shared provisional pack is not double-billed: ' + plus + '/' + deka + '/' + quotedDeka, () => {
    const result = compare(plus, deka, quotedDeka)
    assert.equal(result.comparable, false)
    assert.equal(result.cheaperStore, null)
    assert.equal(result.savingsCents, null)
    assert.equal(result.stores.plus.subtotalCents, 129)
    assert.equal(result.stores.dekamarkt.subtotalCents, quotedDeka)
    assert.equal(result.stores.plus.complete, plus === 'available')
    assert.equal(result.stores.dekamarkt.complete, deka === 'available')
    for (const store of ['plus', 'dekamarkt']) {
      const status = (store === 'plus' ? plus : deka) === 'available'
        ? 'matched' : 'availability_unknown'
      assert.equal(result.lines[0][store].status, status)
      assert.equal(result.lines[1][store].status, status)
      assert.equal(result.lines[0][store].packs, 1)
      assert.equal(result.lines[1][store].packs, 0)
      assert.equal(result.lines[1][store].totalCents, 0)
      assert.equal(result.lines[1][store].sharedPackWithIngredientId, 'breakfast')
      assert.deepEqual(result.lines[0][store].sharedPackCoversIngredientIds, ['breakfast', 'dinner'])
    }
    assert.equal(result.lines[0].differenceCents, null)
    assert.equal(result.lines[1].differenceCents, null)
  })
}

test('M3 product no quote means no manufactured unknown-stock pack cost', () => {
  const observations = [milk('plus', 129, 'available'), {
    ...milk('dekamarkt', 119, 'unknown'), currentPriceCents: null,
  }]
  const result = compareReviewedCatalogs({ requirements: split, observations, nowMs: NOW })
  assert.equal(result.comparable, false)
  assert.equal(result.cheaperStore, null)
  assert.equal(result.savingsCents, null)
  assert.equal(result.lines[0].dekamarkt.totalCents, null)
  assert.equal(result.lines[1].dekamarkt.totalCents, null)
  assert.equal(result.stores.plus.subtotalCents, 129)
})

test('M3 product fully confirmed stock still permits one real physical pack and a fictional offline comparison', () => {
  const result = compare('available', 'available')
  assert.equal(result.comparable, true)
  assert.equal(result.cheaperStore, 'dekamarkt')
  assert.equal(result.savingsCents, 10)
  assert.equal(result.lines[0].plus.packs, 1)
  assert.equal(result.lines[1].plus.packs, 0)
  assert.equal(result.lines[0].differenceCents, -10)
  assert.equal(result.lines[1].differenceCents, 0)
})
