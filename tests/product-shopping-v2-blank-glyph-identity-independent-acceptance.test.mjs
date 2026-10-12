import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { serializeShoppingProgressV2 } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'

// Independent GREEN acceptance after the narrow predicate repair. Fictitious M2
// basket and local in-memory stores only; never retailer/participant evidence.
const invisibleMixes = [
  '\u115f\u1160',
  '\u3164\u2800\u2060',
  '\uffa0\u0301\u200d',
  '\u2800\u115f\u034f\u00ad',
  '\u1160\uffa0\u200b',
]

function fixture() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  })
}

function withIdentity(where, id) {
  const basket = structuredClone(fixture())
  const matched = basket.lines.find(row => row.status === 'matched')
  assert.ok(matched)
  if (where === 'store') basket.store.id = id
  else if (where === 'ingredient') matched.id = id
  else matched.productId = id
  return basket
}

test('independent #1805: composite blank glyphs are not durable physical task identities', () => {
  for (const blank of invisibleMixes) {
    for (const where of ['store', 'ingredient', 'product']) {
      const basket = withIdentity(where, blank)
      const before = structuredClone(basket)
      const writes = []
      const durable = new Map()
      const controller = openShoppingProgressStorageV2(basket, {
        getItem(key) { return durable.get(key) ?? null },
        setItem(key, value) { writes.push([key, value]); durable.set(key, value) },
      })
      assert.equal(shoppingListDemandIdentity(basket), null, where)
      assert.equal(serializeShoppingProgressV2(basket, []), null)
      assert.deepEqual(shoppingListRowsV2(basket, controller.snapshot()), [])
      assert.equal(controller.persist(), false)
      assert.deepEqual(writes, [])
      assert.deepEqual(basket, before)
    }
  }
})

test('independent #1805: unresolved line with blank glyph ID remains uncheckable', () => {
  const basket = fixture()
  const row = basket.lines.find(item => item.status === 'matched')
  assert.ok(row)
  row.status = 'unresolved'
  row.id = '\u2800\u3164'
  const controller = openShoppingProgressStorageV2(basket, null)
  assert.equal(shoppingListDemandIdentity(basket), null)
  assert.equal(serializeShoppingProgressV2(basket, [row.id]), null)
  assert.deepEqual(shoppingListRowsV2(basket, controller.snapshot()), [])
  assert.equal(controller.persist(), false)
})

test('independent #1805: real symbols beside blank glyphs preserve controlled checklist and price refresh', () => {
  for (const readable of ['한글', '⠃⠗⠇', 'cafe\u0301', '🧑‍🍳']) {
    for (const where of ['store', 'ingredient', 'product']) {
      const basket = withIdentity(where, '\u2800' + readable + '\u3164')
      const before = structuredClone(basket)
      const physicalKey = shoppingListDemandIdentity(basket)
      assert.equal(typeof physicalKey, 'string', readable + ' ' + where)
      const writes = []
      const controller = openShoppingProgressStorageV2(basket, {
        getItem() { return null },
        setItem(key, value) { writes.push([key, value]) },
      })
      assert.equal(controller.persist(), true)
      assert.equal(writes.length, 1)
      assert.equal(JSON.parse(writes[0][1]).demandIdentity, physicalKey)

      const repriced = structuredClone(basket)
      const matched = repriced.lines.find(item => item.status === 'matched')
      assert.ok(matched)
      matched.pricePerPackCents += 1
      matched.lineTotalCents += matched.packs
      repriced.totalCents += matched.packs
      assert.equal(shoppingListDemandIdentity(repriced), physicalKey)
      assert.deepEqual(basket, before)
    }
  }
})
