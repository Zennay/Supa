import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'

function controlled() {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: m2Products,
  })
}

function variant(target, value) {
  const copy = structuredClone(controlled())
  const matched = copy.lines.find((line) => line.status === 'matched')
  assert.ok(matched)
  if (target === 'store') copy.store.id = value
  if (target === 'ingredient') matched.id = value
  if (target === 'product') matched.productId = value
  return copy
}

for (const [target, invisible] of [
  ['store', '\u034f'], // combining grapheme joiner: Mn
  ['store', '\u2060'], // word joiner: Cf
  ['ingredient', '\u0610'], // Arabic combining mark: Mn
  ['ingredient', '\u200c'], // zero-width non-joiner: Cf
  ['product', '\u180b'], // Mongolian free variation selector: Mn
  ['product', '\u202e'], // right-to-left override: Cf
]) {
  test(`v2 accepted shopping rows and persistent ticks require visible ${target} ID ${JSON.stringify(invisible)}`, () => {
    const input = variant(target, invisible)
    const prior = structuredClone(input)
    const storageWrites = []
    const controller = openShoppingProgressStorageV2(input, {
      getItem: () => null,
      setItem: (...args) => storageWrites.push(args),
    })
    assert.equal(shoppingListDemandIdentity(input), null)
    assert.equal(controller.snapshot().serialized, null)
    assert.equal(controller.persist(), false)
    assert.deepEqual(shoppingListRowsV2(input, controller.snapshot()), [])
    assert.deepEqual(storageWrites, [])
    assert.deepEqual(input, prior)
  })
}

test('visible Unicode and common programmatic IDs remain valid for physical progress', () => {
  const cases = ['nl-supermarkt', 'NL123', '🥑', 'cafe\u0301', 'winkel-\u2060online', '_', '—']
  for (const value of cases) {
    for (const target of ['store', 'ingredient', 'product']) {
      const input = variant(target, value)
      assert.equal(typeof shoppingListDemandIdentity(input), 'string', `${target}: ${value}`)
      assert.ok(openShoppingProgressStorageV2(input, null).snapshot().serialized)
    }
  }
})
