import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

// Exact fictional, offline raw basket. One 1L pack must cover any two
// separately named 400ml meal demands for the *same* retailer SKU.
const NOW = Date.parse('2026-10-15T10:00:00.000Z')
const observation = (shop, price, available = 'available') => ({
  supermarket: shop,
  sourceProductId: 'milk-1',
  name: 'Halfvolle melk',
  currentPriceCents: price,
  currency: 'EUR',
  pack: { amount: 1000, unit: 'ml', rawText: '1 l' },
  offer: null,
  availability: available,
  provenance: {
    supermarket: shop,
    kind: 'product',
    url: shop === 'plus'
      ? 'https://www.plus.nl/product/fictional-milk'
      : 'https://www.dekamarkt.nl/producten/fictional-milk',
    capturedAt: '2026-10-15T09:00:00Z',
    sha256: 'd'.repeat(64),
  },
})
const rows = () => [observation('plus', 129), observation('dekamarkt', 119)]
const split = [
  { id: 'breakfast-milk', query: 'halfvolle melk', amount: 400, unit: 'ml' },
  { id: 'dinner-milk', query: 'halfvolle melk', amount: 400, unit: 'ml' },
]
const compare = (requirements, observations = rows()) =>
  compareReviewedCatalogs({ requirements, observations, nowMs: NOW })

function assertPooled(result, centsPlus, centsDeka, packs) {
  assert.equal(result.provenance, 'offline-snapshot-preview')
  assert.equal(result.claimable, false)
  assert.equal(result.comparable, true)
  assert.equal(result.cheaperStore, 'dekamarkt')
  assert.equal(result.savingsCents, centsPlus - centsDeka)
  assert.equal(result.stores.plus.subtotalCents, centsPlus)
  assert.equal(result.stores.dekamarkt.subtotalCents, centsDeka)
  for (const store of ['plus', 'dekamarkt']) {
    assert.equal(result.lines[0][store].packs, packs)
    assert.equal(result.lines[1][store].packs, 0)
    assert.equal(result.lines[1][store].totalCents, 0)
    assert.equal(result.lines[1][store].sharedPackWithIngredientId, split[0].id)
    assert.deepEqual(result.lines[0][store].sharedPackCoversIngredientIds,
      [split[0].id, split[1].id])
  }
  assert.equal(result.lines[0].differenceCents, centsDeka - centsPlus)
  assert.equal(result.lines[1].differenceCents, 0)
}

test('product M3: distinct ingredient IDs consume one purchasable physical liter pack per store', () => {
  const input = rows()
  const intact = JSON.stringify({ requirements: split, observations: input })
  const result = compare(split, input)
  assertPooled(result, 129, 119, 1)
  assert.equal(JSON.stringify({ requirements: split, observations: input }), intact)
})

test('product M3: 0.4 L + 400 ml uses exact mixed-unit total, not floating-point guess', () => {
  const demand = [{ ...split[0], amount: 0.4, unit: 'l' }, split[1]]
  assertPooled(compare(demand), 129, 119, 1)
})

test('product M3: one fractional need just over 1L now bills two packs, never one', () => {
  const demand = [{ ...split[0], amount: 0.6, unit: 'l' },
    { ...split[1], amount: 400.000001, unit: 'ml' }]
  assertPooled(compare(demand), 258, 238, 2)
})

test('product M3: same SKU with 1L + 1L requires exactly two packs, never four', () => {
  const demand = split.map((row) => ({ ...row, amount: 1000 }))
  assertPooled(compare(demand), 258, 238, 2)
})

test('product M3: shared unavailable retailer stock still prevents price winner', () => {
  const r = compare(split, [observation('plus', 129),
    observation('dekamarkt', 119, 'unknown')])
  assert.equal(r.comparable, false)
  assert.equal(r.cheaperStore, null)
  assert.equal(r.savingsCents, null)
  assert.equal(r.claimable, false)
})

test('product M3: a zero or unsupported shared demand never mints a paid basket winner', () => {
  for (const invalid of [{ ...split[0], amount: 0 },
    { ...split[0], unit: 'unknown' },
    { ...split[0], amount: Number.MAX_VALUE }]) {
    const result = compare([invalid, split[1]])
    assert.equal(result.comparable, false)
    assert.equal(result.savingsCents, null)
    assert.equal(result.cheaperStore, null)
  }
})

test('product M3: group allocation is deterministic and follows caller ingredient order', () => {
  const swapped = [split[1], split[0]]
  const r = compare(swapped)
  assert.equal(r.comparable, true)
  assert.equal(r.stores.plus.subtotalCents, 129)
  assert.deepEqual(r.lines[0].plus.sharedPackCoversIngredientIds,
    ['dinner-milk', 'breakfast-milk'])
  assert.equal(r.lines[1].plus.sharedPackWithIngredientId, 'dinner-milk')
})
