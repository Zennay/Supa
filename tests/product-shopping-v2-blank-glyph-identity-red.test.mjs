import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { serializeShoppingProgressV2 } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'

// Controlled M2 fixtures; these glyphs are visibly blank despite Unicode graphic categories.
// No human retailer observations, participant details or savings claims.
const blankGlyphs = [
  ['Hangul choseong filler U+115F', '\u115f'],
  ['Hangul jungseong filler U+1160', '\u1160'],
  ['Hangul filler U+3164', '\u3164'],
  ['halfwidth Hangul filler U+FFA0', '\uffa0'],
  ['Braille Pattern Blank U+2800', '\u2800'],
]

function changed(which, id) {
  const basket = structuredClone(buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  }))
  const row = basket.lines.find(line => line.status === 'matched')
  assert.ok(row)
  if (which === 'store') basket.store.id = id
  if (which === 'ingredient') row.id = id
  if (which === 'product') row.productId = id
  return basket
}

for (const [name, glyph] of blankGlyphs) {
  for (const which of ['store', 'ingredient', 'product']) {
    test('product #1805 expected RED: ' + name + ' cannot be sole ' + which + ' identity', () => {
      const basket = changed(which, glyph)
      const original = structuredClone(basket)
      const writes = []
      const controller = openShoppingProgressStorageV2(basket, {
        getItem() { return null },
        setItem(key, value) { writes.push([key, value]) },
      })
      assert.equal(shoppingListDemandIdentity(basket), null)
      assert.equal(serializeShoppingProgressV2(basket, []), null)
      assert.deepEqual(shoppingListRowsV2(basket, controller.snapshot()), [])
      assert.equal(controller.persist(), false)
      assert.deepEqual(writes, [])
      assert.deepEqual(basket, original)
    })
  }
}

test('product #1805: blank glyphs mixed only with marks/format stay unidentifiable', () => {
  for (const [, glyph] of blankGlyphs) {
    for (const which of ['store', 'ingredient', 'product']) {
      const basket = changed(which, '\u200b' + glyph + '\u0301\u2060')
      assert.equal(shoppingListDemandIdentity(basket), null)
      assert.equal(serializeShoppingProgressV2(basket, []), null)
    }
  }
})

test('product #1805: actually readable Braille, Korean, emoji and accents remain valid', () => {
  for (const visible of ['한글', '⠃⠗⠇', '🧑‍🍳', 'cafe\u0301']) {
    for (const [, glyph] of blankGlyphs) {
      for (const which of ['store', 'ingredient', 'product']) {
        const basket = changed(which, glyph + visible)
        const identity = shoppingListDemandIdentity(basket)
        assert.equal(typeof identity, 'string', which + ' ' + visible)
        const writes = []
        const controller = openShoppingProgressStorageV2(basket, {
          getItem() { return null },
          setItem(key, value) { writes.push([key, value]) },
        })
        assert.equal(controller.persist(), true)
        assert.equal(writes.length, 1)
      }
    }
  }
})
