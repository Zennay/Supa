import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// Independent QA of the ACTIVE product owner's shared-SKU pack-pooling branch.
// Different physical pack sizes across PLUS and DekaMarkt are handled per store;
// prices, SKUs, time, availability and sources are entirely fictional/offline.
const NOW = Date.parse('2026-10-15T10:00:00.000Z')

function source(shop, id) {
  return {
    supermarket: shop, kind: 'product',
    url: shop === 'plus'
      ? 'https://www.plus.nl/product/fictional-' + id
      : 'https://www.dekamarkt.nl/producten/fictional-' + id,
    capturedAt: '2026-10-15T09:00:00.000Z',
    sha256: 'a'.repeat(64),
  }
}

function product(shop, id, name, amount, unit, cents) {
  return {
    supermarket: shop, sourceProductId: id, name,
    currentPriceCents: cents, currency: 'EUR',
    pack: { rawText: amount + ' ' + unit, amount, unit },
    availability: 'available', offer: null,
    provenance: source(shop, id),
  }
}

const prices = () => [
  product('plus', 'milk', 'Halfvolle melk', 1000, 'ml', 129),
  product('dekamarkt', 'milk', 'Halfvolle melk', 500, 'ml', 75),
]

const milk = (id, amount, unit = 'ml') => ({
  id, query: 'halfvolle melk', amount, unit,
})

function compare(requirements, observations = prices()) {
  const bytes = JSON.stringify({ requirements, observations })
  const result = compareReviewedCatalogs({ requirements, observations, nowMs: NOW })
  assert.equal(JSON.stringify({ requirements, observations }), bytes,
    'comparison must not rewrite source evidence or demand')
  assert.equal(result.provenance, 'offline-snapshot-preview')
  assert.equal(result.claimable, false)
  return result
}

function assertPooled(result, plusPacks, dekaPacks, winner, cents) {
  assert.equal(result.comparable, true)
  assert.equal(result.cheaperStore, winner)
  assert.equal(result.savingsCents, cents)
  assert.equal(result.stores.plus.complete, true)
  assert.equal(result.stores.dekamarkt.complete, true)
  assert.equal(result.stores.plus.subtotalCents, plusPacks * 129)
  assert.equal(result.stores.dekamarkt.subtotalCents, dekaPacks * 75)
  assert.equal(result.lines[0].plus.packs, plusPacks)
  assert.equal(result.lines[0].dekamarkt.packs, dekaPacks)
  for (const item of result.lines.slice(1)) {
    for (const store of ['plus', 'dekamarkt']) {
      assert.equal(item[store].packs, 0)
      assert.equal(item[store].totalCents, 0)
      assert.equal(item[store].sharedPackWithIngredientId, result.lines[0].ingredientId)
    }
  }
  assert.equal(result.lines[0].differenceCents,
    dekaPacks * 75 - plusPacks * 129)
}

test('independent: mixed 1L PLUS vs 500ml Deka pack pooling can make PLUS cheaper', () => {
  assertPooled(compare([milk('coffee', 400), milk('breakfast', 400)]),
    1, 2, 'plus', 21)
})

test('independent: two physical retailers can reverse their winner above 1 liter total', () => {
  assertPooled(compare([milk('coffee', 600), milk('breakfast', 600)]),
    2, 3, 'dekamarkt', 33)
})

test('independent: exactly 1000ml over three distinct meals purchases 1L vs two half-liter packs', () => {
  assertPooled(compare([milk('coffee', 200), milk('dinner', 300), milk('breakfast', 500)]),
    1, 2, 'plus', 21)
})

test('independent: +1 millionth ml over 1000ml requires second plus and third deka physical pack', () => {
  assertPooled(compare([milk('coffee', 200), milk('dinner', 300),
    milk('breakfast', 500.000001)]), 2, 3, 'dekamarkt', 33)
})

test('independent: mixed liter and milliliter requirements use exact pooled physical units per retailer', () => {
  assertPooled(compare([milk('coffee', 0.4, 'l'), milk('breakfast', 400)]),
    1, 2, 'plus', 21)
})

test('three-line purchase totals cannot change when identical requirements are permuted', () => {
  const original = [milk('coffee', 200), milk('dinner', 300), milk('breakfast', 500)]
  const result = compare(original)
  const expected = {
    plus: result.stores.plus.subtotalCents,
    deka: result.stores.dekamarkt.subtotalCents,
    cheaper: result.cheaperStore,
    savings: result.savingsCents,
  }
  for (const reordered of [
    [...original].reverse(),
    [original[1], original[2], original[0]],
    [original[2], original[0], original[1]],
  ]) {
    const r = compare(reordered)
    assert.equal(r.stores.plus.subtotalCents, expected.plus)
    assert.equal(r.stores.dekamarkt.subtotalCents, expected.deka)
    assert.equal(r.cheaperStore, expected.cheaper)
    assert.equal(r.savingsCents, expected.savings)
    assert.deepEqual(r.lines[0].plus.sharedPackCoversIngredientIds,
      reordered.map(item => item.id))
  }
})

test('a physically independent ingredient cannot be absorbed into pooled milk costs', () => {
  const requirements = [
    milk('coffee', 400),
    { id: 'rice', query: 'basmati rijst', amount: 500, unit: 'g' },
    milk('breakfast', 400),
  ]
  const observations = [...prices(),
    product('plus', 'rice', 'Basmati rijst', 500, 'g', 210),
    product('dekamarkt', 'rice', 'Basmati rijst', 500, 'g', 200)]
  const r = compare(requirements, observations)
  assert.equal(r.comparable, true)
  assert.equal(r.stores.plus.subtotalCents, 339)
  assert.equal(r.stores.dekamarkt.subtotalCents, 350)
  assert.equal(r.cheaperStore, 'plus')
  assert.equal(r.savingsCents, 11)
  assert.equal(r.lines[1].plus.totalCents, 210)
  assert.equal(r.lines[1].dekamarkt.totalCents, 200)
  assert.equal(r.lines[1].plus.sharedPackWithIngredientId, undefined)
  assert.equal(r.lines[1].dekamarkt.sharedPackWithIngredientId, undefined)
  assert.equal(r.lines[2].plus.sharedPackWithIngredientId, 'coffee')
  assert.equal(r.lines[2].dekamarkt.sharedPackWithIngredientId, 'coffee')
})

test('unknown stock on either retailer never becomes free shared SKU stock', () => {
  for (const shop of ['plus', 'dekamarkt']) {
    const observations = prices().map(record =>
      record.supermarket === shop ? { ...record, availability: 'unknown' } : record)
    const r = compare([milk('coffee', 400), milk('breakfast', 400)], observations)
    assert.equal(r.comparable, false)
    assert.equal(r.cheaperStore, null)
    assert.equal(r.savingsCents, null)
    assert.equal(r.claimable, false)
  }
})
