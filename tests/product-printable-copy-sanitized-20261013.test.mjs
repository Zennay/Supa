import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'

function basket() {
  return structuredClone(buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  }))
}
const unsafe = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u

test('multiple mixed controls are removed from printed labels without mutating input', () => {
  const input = basket()
  const matched = input.lines.find(x => x.status === 'matched')
  assert.ok(matched)
  input.store.name = 'Café\u202e Winkel\u0000'
  matched.productName = 'Tërïyakí\u2066 \u200b🥣\n'
  const before = structuredClone(input)
  const result = preparePrintableShoppingChecklist(input)
  assert.deepEqual(input, before)
  assert.equal(result.storeLabel, 'Café Winkel')
  assert.ok(result.lines.some(x => x.label === 'Tërïyakí 🥣' && !x.needsReview))
  assert.equal(unsafe.test(result.storeLabel), false)
  assert.equal(result.lines.some(x => unsafe.test(x.label)), false)
  assert.equal(result.lines.some(x => /€|priceCents|savings/i.test(x.quantity)), false)
})

test('controls-only unresolved labels cannot be printed as trusted names', () => {
  const input = basket()
  input.store.name = '\u2066\u200b'
  const matched = input.lines.find(x => x.status === 'matched')
  assert.ok(matched)
  matched.status = 'unresolved'
  matched.ingredientLabel = '\u202e\u2069\u0001'
  const result = preparePrintableShoppingChecklist(input)
  assert.equal(result.storeLabel, 'Winkel nog te kiezen')
  assert.ok(result.lines.some(x => x.needsReview && x.label === 'Onbekend ingrediënt'))
  assert.equal(result.reviewCount > 0, true)
})
