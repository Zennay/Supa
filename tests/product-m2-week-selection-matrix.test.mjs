import assert from 'node:assert/strict'
import test from 'node:test'

import {
  aggregatePlanIngredients,
  buildOneStoreBasket,
} from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

function basketFor(activeDays, plan = m2InitialPlan, products = m2Products) {
  return buildOneStoreBasket({
    store: m2Store,
    plan,
    recipes: m2Recipes,
    activeDays,
    products,
  })
}

// Exhaust every combination instead of checking only the default week and
// one manually switched-off day. All inputs are local controlled M2 fixtures.
test('all sixteen M2 week selections produce deterministic, traceable baskets', () => {
  const days = m2DefaultActiveDays
  assert.equal(days.length, 4)

  for (let mask = 0; mask < (1 << days.length); mask += 1) {
    const activeDays = days.filter((_, index) => (mask & (1 << index)) !== 0)
    const basket = basketFor(activeDays)
    const reversed = basketFor(
      [...activeDays].reverse(),
      [...m2InitialPlan].reverse(),
    )
    const ingredients = aggregatePlanIngredients(
      m2InitialPlan,
      m2Recipes,
      activeDays,
    )
    const expectedIds = new Set(ingredients.map((ingredient) => ingredient.id))
    const tracedIds = basket.lines.map((line) => line.id)
    const matched = basket.lines.filter((line) => line.status === 'matched')
    const unresolved = basket.lines.filter((line) => line.status === 'unresolved')

    assert.deepEqual(reversed, basket, `order-dependent week at mask ${mask}`)
    assert.equal(basket.selectedMealCount, activeDays.length)
    assert.deepEqual(new Set(tracedIds), expectedIds)
    assert.equal(new Set(tracedIds).size, tracedIds.length)
    assert.equal(basket.matchedLineCount, matched.length)
    assert.equal(basket.unresolvedLineCount, unresolved.length)
    assert.equal(basket.lines.length, matched.length + unresolved.length)
    assert.equal(
      basket.totalCents,
      matched.reduce((sum, line) => sum + line.lineTotalCents, 0),
      `trace total disagrees with basket at mask ${mask}`,
    )
    assert.ok(Number.isSafeInteger(basket.totalCents))
    assert.ok(basket.totalCents >= 0)

    for (const line of matched) {
      assert.ok(Number.isSafeInteger(line.packs) && line.packs > 0)
      assert.ok(Number.isSafeInteger(line.pricePerPackCents))
      assert.equal(line.lineTotalCents, line.packs * line.pricePerPackCents)
      assert.ok(expectedIds.has(line.id))
    }
    for (const line of unresolved) {
      assert.ok(line.reasons.length > 0)
      assert.equal('lineTotalCents' in line, false)
    }
  }
})

test('empty M2 selection has no phantom basket, cost, or unresolved lines', () => {
  const basket = basketFor([])
  assert.equal(basket.selectedMealCount, 0)
  assert.deepEqual(basket.lines, [])
  assert.equal(basket.totalCents, 0)
  assert.equal(basket.matchedLineCount, 0)
  assert.equal(basket.unresolvedLineCount, 0)
})

test('switching off the final day removes its exclusive demand without editing fixtures', () => {
  const original = basketFor(['Wo'])
  assert.equal(original.selectedMealCount, 1)
  assert.ok(original.lines.some((line) => line.id === 'spaghetti'))

  const empty = basketFor([])
  assert.equal(empty.lines.some((line) => line.id === 'spaghetti'), false)

  const restored = basketFor(['Wo'])
  assert.deepEqual(restored, original)
  assert.deepEqual(m2DefaultActiveDays, ['Ma', 'Di', 'Wo', 'Do'])
})
