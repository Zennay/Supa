import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

/** All retailer snapshots below are invented, offline data, not actual shop prices. */
const NOW = Date.parse('2026-10-15T10:00:00Z')
const requirements = [
  { id: 'breakfast', query: 'halfvolle melk ontbijt', amount: 400, unit: 'ml' },
  { id: 'dinner', query: 'halfvolle melk diner', amount: 0.4, unit: 'l' },
]
const packageRow = (shop, id, name, cents, amount = 1000, availability = 'available') => ({
  supermarket: shop,
  sourceProductId: id,
  name,
  currentPriceCents: cents,
  currency: 'EUR',
  pack: { amount, unit: 'ml', rawText: amount === 1000 ? '1 l' : '500 ml' },
  availability,
  offer: null,
  provenance: {
    supermarket: shop, kind: 'product',
    url: shop === 'plus'
      ? 'https://www.plus.nl/product/' + id
      : 'https://www.dekamarkt.nl/producten/' + id,
    capturedAt: '2026-10-15T09:00:00Z', sha256: 'b'.repeat(64),
  },
})
const combined = shop => packageRow(
  shop, 'shared-milk', 'Halfvolle melk ontbijt halfvolle melk diner', 129,
)
const split = shop => [
  packageRow(shop, 'breakfast-milk', 'Halfvolle melk ontbijt', 80, 500),
  packageRow(shop, 'dinner-milk', 'Halfvolle melk diner', 75, 500),
]
const rice = shop => ({
  ...packageRow(shop, 'rice', 'Basmati rijst', shop === 'plus' ? 250 : 235),
  pack: { amount: 500, unit: 'g', rawText: '500 g' },
})
const riceRequirement = { id: 'rice', query: 'basmati rijst', amount: 500, unit: 'g' }
const compare = (demands, observations) => {
  const intact = JSON.stringify({ demands, observations })
  const result = compareReviewedCatalogs({ requirements: demands, observations, nowMs: NOW })
  assert.equal(JSON.stringify({ demands, observations }), intact,
    'offline input observations and meal demands must never mutate')
  assert.equal(result.provenance, 'offline-snapshot-preview')
  assert.equal(result.claimable, false)
  return result
}

function assertAsymmetric(result, cheapShop, expectedPlus, expectedDeka) {
  assert.equal(result.comparable, true, 'full exact physical basket remains usable')
  assert.equal(result.cheaperStore, cheapShop)
  assert.equal(result.stores.plus.subtotalCents, expectedPlus)
  assert.equal(result.stores.dekamarkt.subtotalCents, expectedDeka)
  assert.equal(result.savingsCents, Math.abs(expectedDeka - expectedPlus))
  for (const line of result.lines.filter(l => l.ingredientId !== 'rice')) {
    assert.equal(line.plus.status, 'matched')
    assert.equal(line.dekamarkt.status, 'matched')
    assert.equal(line.differenceCents, null,
      'shared and independent purchases are incomparable as individual lines')
  }
}

test('M3 asymmetric SKU group: PLUS one physical pack vs two DekaMart 500ml products hides false line deltas', () => {
  const r = compare(requirements, [combined('plus'), ...split('dekamarkt')])
  assertAsymmetric(r, 'plus', 129, 155)
  assert.equal(r.lines[0].plus.totalCents, 129)
  assert.equal(r.lines[1].plus.totalCents, 0)
  assert.equal(r.lines[0].dekamarkt.totalCents, 80)
  assert.equal(r.lines[1].dekamarkt.totalCents, 75)
  assert.deepEqual(r.lines[0].plus.sharedPackCoversIngredientIds, ['breakfast', 'dinner'])
  assert.equal(r.lines[1].plus.sharedPackWithIngredientId, 'breakfast')
})

test('M3 asymmetric SKU group: two PLUS 500ml products vs one Deka physical pack hides false line deltas', () => {
  const r = compare(requirements, [...split('plus'), combined('dekamarkt')])
  assertAsymmetric(r, 'dekamarkt', 155, 129)
  assert.deepEqual(r.lines[0].dekamarkt.sharedPackCoversIngredientIds, ['breakfast', 'dinner'])
  assert.equal(r.lines[1].dekamarkt.sharedPackWithIngredientId, 'breakfast')
})

test('M3 asymmetric SKU group: reordering ingredient IDs does not invent an item advantage', () => {
  const r = compare([...requirements].reverse(),
    [combined('plus'), ...split('dekamarkt')])
  assertAsymmetric(r, 'plus', 129, 155)
  assert.equal(r.lines[0].plus.sharedPackCoversIngredientIds?.[0], 'dinner')
})

test('M3 asymmetric SKU group: independent priced rice line retains its exact comparison', () => {
  const r = compare([...requirements, riceRequirement],
    [combined('plus'), ...split('dekamarkt'), rice('plus'), rice('dekamarkt')])
  assertAsymmetric(r, 'plus', 379, 390)
  assert.equal(r.lines[2].differenceCents, -15, 'unrelated rice is priced normally')
  assert.equal(r.lines[2].plus.totalCents, 250)
  assert.equal(r.lines[2].dekamarkt.totalCents, 235)
})

test('M3 symmetric shared-pack group: group-owner 10-cent delta and zero-additional-pack row remain intact', () => {
  const r = compare(requirements, [combined('plus'), {
    ...combined('dekamarkt'), currentPriceCents: 119,
  }])
  assert.equal(r.comparable, true)
  assert.equal(r.cheaperStore, 'dekamarkt')
  assert.equal(r.savingsCents, 10)
  assert.equal(r.lines[0].differenceCents, -10)
  assert.equal(r.lines[1].differenceCents, 0)
  assert.deepEqual(r.lines[0].plus.sharedPackCoversIngredientIds,
    r.lines[0].dekamarkt.sharedPackCoversIngredientIds)
})

test('M3 asymmetric group: unknown stock still prevents a winner and both pooled row savings', () => {
  const observations = [combined('plus'), ...split('dekamarkt')]
  observations[1] = { ...observations[1], availability: 'unknown' }
  const r = compare(requirements, observations)
  assert.equal(r.comparable, false)
  assert.equal(r.cheaperStore, null)
  assert.equal(r.savingsCents, null)
  for (const line of r.lines) assert.equal(line.differenceCents, null)
})
