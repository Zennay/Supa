import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// Independent QA-only oracle against the composed M3 draft. Every product,
// amount and price is fictional. No retailer network, source reuse right,
// checkout receipt, human 11+11 observation or public savings claim.
const NOW = Date.parse('2026-10-15T10:00:00Z')
const STORES = ['plus', 'dekamarkt']
const MILK_PRICE = { plus: 129, dekamarkt: 75 }
const RICE_PRICE = { plus: 210, dekamarkt: 200 }

function observation(shop, name, id, amount, unit, cents, stock = 'available') {
  return {
    supermarket: shop, sourceProductId: id, name,
    currentPriceCents: cents, currency: 'EUR',
    pack: { amount, unit, rawText: amount + ' ' + unit },
    availability: stock, offer: null,
    provenance: {
      supermarket: shop, kind: 'product',
      url: shop === 'plus'
        ? 'https://www.plus.nl/product/fictional-' + id
        : 'https://www.dekamarkt.nl/producten/fictional-' + id,
      capturedAt: '2026-10-15T09:00:00Z', sha256: 'c'.repeat(64),
    },
  }
}

function prepare(demands, milkUnknown = null) {
  const requirements = demands.map((demand, i) => ({
    id: 'meal-' + i, query: 'halfvolle melk', amount: demand.amount,
    unit: demand.unit ?? 'ml',
  }))
  requirements.push({ id: 'rice', query: 'basmati rijst', amount: 500, unit: 'g' })
  const observations = STORES.flatMap(shop => [
    observation(shop, 'Halfvolle melk', 'milk-' + shop,
      shop === 'plus' ? 1000 : 500, 'ml', MILK_PRICE[shop],
      milkUnknown === shop ? 'unknown' : 'available'),
    observation(shop, 'Basmati rijst', 'rice-' + shop,
      500, 'g', RICE_PRICE[shop]),
  ])
  return { requirements, observations }
}

function checkedCompare(requirements, observations) {
  const evidence = JSON.stringify({ requirements, observations })
  const result = compareReviewedCatalogs({ requirements, observations, nowMs: NOW })
  assert.equal(JSON.stringify({ requirements, observations }), evidence,
    'comparator cannot rewrite the original observation or recipe requirements')
  assert.equal(result.provenance, 'offline-snapshot-preview')
  assert.equal(result.claimable, false)
  return result
}

// Hand-calculated whole-pack oracle, deliberately NOT reusing production pack
// arithmetic. Each case includes a separate 500g rice purchase per store.
const CASES = [
  { amounts: [1, 1, 1], plus: 1, deka: 1 },
  { amounts: [250, 250, 250], plus: 1, deka: 2 },
  { amounts: [100, 100, 800], plus: 1, deka: 2 },
  { amounts: [1000, 1, 1], plus: 2, deka: 3 },
  { amounts: [600, 600, 600], plus: 2, deka: 4 },
  { amounts: [1, 999, 1], plus: 2, deka: 3 },
  { amounts: [500, 500, 0.000001], plus: 2, deka: 3 },
  { amounts: [1, 1, 1000.000001], plus: 2, deka: 3 },
  { amounts: [500, { amount: 0.5, unit: 'l' }, 0.000001], plus: 2, deka: 3 },
]

for (const [caseId, record] of CASES.entries()) {
  for (const reversed of [false, true]) {
    test('physical basket oracle case ' + caseId +
      (reversed ? ' reversed input order' : ' original input order'), () => {
      const demands = record.amounts.map(value =>
        typeof value === 'number' ? { amount: value } : value)
      if (reversed) demands.reverse()
      const { requirements, observations } = prepare(demands)
      const r = checkedCompare(requirements, observations)
      const plus = record.plus * MILK_PRICE.plus + RICE_PRICE.plus
      const deka = record.deka * MILK_PRICE.dekamarkt + RICE_PRICE.dekamarkt
      const delta = deka - plus
      assert.equal(r.comparable, true)
      assert.equal(r.stores.plus.complete, true)
      assert.equal(r.stores.dekamarkt.complete, true)
      assert.equal(r.stores.plus.subtotalCents, plus)
      assert.equal(r.stores.dekamarkt.subtotalCents, deka)
      assert.equal(r.savingsCents, Math.abs(delta))
      assert.equal(r.cheaperStore, delta > 0 ? 'plus' : delta < 0 ? 'dekamarkt' : 'equal')
      assert.equal(r.lines.length, requirements.length)
      const milkIds = requirements.slice(0, -1).map(item => item.id)
      for (const shop of STORES) {
        const packs = shop === 'plus' ? record.plus : record.deka
        assert.equal(r.lines[0][shop].packs, packs)
        assert.equal(r.lines[0][shop].totalCents, packs * MILK_PRICE[shop])
        assert.deepEqual(r.lines[0][shop].sharedPackCoversIngredientIds, milkIds)
        for (const covered of r.lines.slice(1, -1)) {
          assert.equal(covered[shop].packs, 0)
          assert.equal(covered[shop].totalCents, 0)
          assert.equal(covered[shop].sharedPackWithIngredientId, milkIds[0])
        }
        const rice = r.lines.at(-1)[shop]
        assert.equal(rice.packs, 1)
        assert.equal(rice.totalCents, RICE_PRICE[shop])
        assert.equal(rice.sharedPackWithIngredientId, undefined)
      }
      assert.equal(r.lines[0].differenceCents,
        record.deka * MILK_PRICE.dekamarkt - record.plus * MILK_PRICE.plus)
      assert.equal(r.lines.at(-1).differenceCents,
        RICE_PRICE.dekamarkt - RICE_PRICE.plus)
      assert.equal(r.lines.reduce((sum, line) => sum + line.differenceCents, 0), delta,
        'sum of independently stocked line deltas equals full-basket delta')
    })
  }
}

for (const shop of STORES) {
  for (const demand of [[250, 250, 250], [1000, 1, 1], [500, 500, 0.000001]]) {
    test('unknown stock cannot imply a basket winner or milk line delta: ' +
      shop + ' / ' + demand.join('+'), () => {
      const { requirements, observations } = prepare(
        demand.map(amount => ({ amount })), shop)
      const r = checkedCompare(requirements, observations)
      assert.equal(r.comparable, false)
      assert.equal(r.cheaperStore, null)
      assert.equal(r.savingsCents, null)
      assert.equal(r.stores[shop].complete, false)
      for (const line of r.lines.slice(0, -1)) {
        assert.equal(line[shop].status, 'availability_unknown')
        assert.equal(line.differenceCents, null,
          'quoted but physically unconfirmed stock is not a realizable line saving')
      }
      assert.equal(r.lines.at(-1).plus.status, 'matched')
      assert.equal(r.lines.at(-1).dekamarkt.status, 'matched')
      assert.equal(r.lines.at(-1).differenceCents, -10,
        'independent confirmed rice prices remain usable as line information')
    })
  }
}
