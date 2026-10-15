import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'

/** Independent mixed-unit proof (all labels, URLs, prices and permissions
 * fictional). Tests real matching, packaging and comparator—not a mock. */
const nowMs = Date.parse('2026-10-15T10:00:00.000Z')
const inputs = [
  { query: 'zilvervliesrijst', amount: 1250, unit: 'g',
    plus: [1, 'kg', '1 kg', 175, 2],
    dekamarkt: [500, 'g', '500 g', 95, 3] },
  { query: 'halfvolle melk', amount: 1500, unit: 'ml',
    plus: [1, 'l', '1 l', 129, 2],
    dekamarkt: [500, 'ml', '2 x 500 ml', 99, 2] },
  { query: 'scharreleieren', amount: 7, unit: 'piece',
    plus: [6, 'piece', '6 st', 225, 2],
    dekamarkt: [10, 'piece', '10 st', 375, 1] },
  { query: 'hummus naturel', amount: 275, unit: 'g',
    plus: [200, 'g', '200 g', 139, 2],
    dekamarkt: [0.5, 'kg', '0.5 kg', 285, 1] },
  { query: 'olijfolie', amount: 0.75, unit: 'l',
    plus: [500, 'ml', '500 ml', 449, 2],
    dekamarkt: [0.75, 'l', '0.75 l', 835, 1] },
  { query: 'tofu blokjes', amount: 3, unit: 'piece',
    plus: [2, 'piece', '2 st', 210, 2],
    dekamarkt: [3, 'piece', '3 st', 399, 1] },
]

function makeObservations() {
  return inputs.flatMap((row, idx) =>
    ['plus', 'dekamarkt'].map(shop => {
      const [amount, unit, rawText, cents] = row[shop]
      return {
        supermarket: shop,
        sourceProductId: `fixture-${idx}`,
        name: row.query,
        currentPriceCents: cents,
        currency: 'EUR',
        pack: { amount, unit, rawText },
        offer: null, availability: 'available',
        provenance: {
          supermarket: shop, kind: 'product',
          url: shop === 'plus'
            ? `https://www.plus.nl/product/fictional-${idx}`
            : `https://www.dekamarkt.nl/producten/fictional-${idx}`,
          capturedAt: '2026-10-15T09:00:00.000Z',
          sha256: (idx + 21).toString(16).padStart(64, '0'),
        },
      }
    }))
}

function requirements() {
  return inputs.map((row, idx) => ({
    id: `ingredient-${idx}`,
    query: row.query, amount: row.amount, unit: row.unit,
  }))
}

function compare(reqs, observations) {
  return compareReviewedCatalogs({ requirements: reqs, observations, nowMs })
}

function assertMoney(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.provenance, 'offline-snapshot-preview')
  assert.equal(result.comparable, true)
  assert.equal(result.lines.length, 6)
  let plus = 0, deka = 0
  for (let i = 0; i < inputs.length; i++) {
    const row = inputs[i], line = result.lines[i]
    const expectedPlus = row.plus[3] * row.plus[4]
    const expectedDeka = row.dekamarkt[3] * row.dekamarkt[4]
    plus += expectedPlus
    deka += expectedDeka
    assert.equal(line.ingredientId, `ingredient-${i}`)
    assert.equal(line.plus.packs, row.plus[4])
    assert.equal(line.dekamarkt.packs, row.dekamarkt[4])
    assert.equal(line.plus.totalCents, expectedPlus)
    assert.equal(line.dekamarkt.totalCents, expectedDeka)
    assert.equal(line.differenceCents, expectedDeka - expectedPlus)
  }
  assert.equal(plus, 2654)
  assert.equal(deka, 2377)
  assert.equal(result.stores.plus.subtotalCents, plus)
  assert.equal(result.stores.dekamarkt.subtotalCents, deka)
  assert.equal(result.cheaperStore, 'dekamarkt')
  assert.equal(result.savingsCents, 277)
}

test('six synthetic everyday ingredients: grams, kilograms, liters, milliliters, multipacks and pieces match exact cents', () => {
  const observations = makeObservations()
  const frozen = JSON.stringify(observations)
  assertMoney(compare(requirements(), observations))
  assert.equal(JSON.stringify(observations), frozen)
})

test('changing only the requirement unit to physically equivalent expression leaves all six basket lines invariant', () => {
  const baseline = compare(requirements(), makeObservations())
  const equivalent = requirements()
  equivalent[0] = { ...equivalent[0], amount: 1.25, unit: 'kg' }
  equivalent[1] = { ...equivalent[1], amount: 1.5, unit: 'l' }
  equivalent[3] = { ...equivalent[3], amount: 0.275, unit: 'kg' }
  equivalent[4] = { ...equivalent[4], amount: 750, unit: 'ml' }
  const result = compare(equivalent, makeObservations())
  assertMoney(result)
  assert.deepEqual(result.lines.map(line => [line.plus.packs, line.dekamarkt.packs]),
    baseline.lines.map(line => [line.plus.packs, line.dekamarkt.packs]))
  assert.equal(result.savingsCents, baseline.savingsCents)
})

test('one of twelve mixed-unit observations unavailable means unknown full basket despite other known line totals', () => {
  const observations = makeObservations().filter(row =>
    !(row.supermarket === 'dekamarkt' && row.sourceProductId === 'fixture-4'))
  const result = compare(requirements(), observations)
  assert.equal(result.comparable, false)
  assert.equal(result.cheaperStore, null)
  assert.equal(result.savingsCents, null)
  assert.equal(result.claimable, false)
  assert.equal(result.lines[4].dekamarkt.totalCents, null)
  assert.equal(result.lines[4].plus.totalCents, 898)
})
