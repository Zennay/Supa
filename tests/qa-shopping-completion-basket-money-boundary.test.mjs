import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'
import { shoppingListCompletion } from '../src/features/shopping-list/shoppingListCompletion.ts'

// Quality-validation stacked on product owner #1082, without runtime changes.
// These baskets are synthetic fixtures, not store observations or purchase proof.
function canonicalTuesday() {
  const basket = buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: ['Di'],
    products: m2Products,
  })
  assert.equal(basket.selectedMealCount, 1)
  assert.equal(basket.unresolvedLineCount, 0)
  assert.ok(basket.matchedLineCount > 0)
  assert.ok(basket.totalCents > 0)
  return basket
}

test('control: the original integer-cent basket keeps normal checked progress', () => {
  const basket = canonicalTuesday()
  const checked = basket.lines.map((line) => line.id)
  const before = structuredClone(basket)

  assert.equal(shoppingListCompletion(basket, checked).state, 'complete')
  assert.equal(shoppingListCompletion(basket, []).state, 'in-progress')
  assert.deepEqual(basket, before)
})

test('untrusted basket-level money must never authorize a completed shopping list', async (t) => {
  const original = canonicalTuesday()
  const alteredTotals = [
    ['missing totalCents', undefined],
    ['explicit null totalCents', null],
    ['string totalCents', String(original.totalCents)],
    ['NaN totalCents', Number.NaN],
    ['infinite totalCents', Infinity],
    ['negative totalCents', -1],
    ['fractional totalCents', original.totalCents + 0.25],
    ['unsafe-integer totalCents', Number.MAX_SAFE_INTEGER + 1],
    ['balanced-looking but false totalCents', original.totalCents + 1],
  ]
  for (const [name, totalCents] of alteredTotals) {
    await t.test(name, () => {
      const basket = { ...original, totalCents }
      const snapshot = structuredClone(basket)
      const checked = basket.lines.map((line) => line.id)
      for (const doneIds of [checked, []]) {
        const result = shoppingListCompletion(basket, doneIds)
        assert.equal(
          result.state,
          'invalid',
          name + ': malformed or unreconciled total cannot be presented as trusted progress',
        )
        assert.equal(result.checkedCount, 0, name)
        assert.doesNotMatch(result.message, /Alle boodschappen afgevinkt\./)
      }
      assert.deepEqual(basket, snapshot, name + ': validation must not alter inputs')
    })
  }
})

test('safe zero-price matched packs remain distinguishable from missing total metadata', () => {
  const original = canonicalTuesday()
  const zeroCost = {
    ...original,
    totalCents: 0,
    lines: original.lines.map((line) =>
      line.status === 'matched'
        ? { ...line, pricePerPackCents: 0, lineTotalCents: 0 }
        : line,
    ),
  }
  const checked = zeroCost.lines.map((line) => line.id)
  assert.equal(
    shoppingListCompletion(zeroCost, checked).state,
    'complete',
    'a genuine internally consistent zero-cost synthetic basket is not an unknown total',
  )
})
