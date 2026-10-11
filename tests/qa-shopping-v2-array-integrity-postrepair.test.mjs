import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  reconcileTrustedShoppingProgressV2,
  restoreTrustedShoppingProgressV2,
  serializeTrustedShoppingProgressV2,
  toggleTrustedShoppingProgressV2,
} from '../src/features/shopping-list/shoppingListTrustedProgressV2.ts'
import {
  reconcileShoppingProgressV2,
  serializeShoppingProgressV2,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

function current() {
  const basket = buildOneStoreBasket({
    store: m2Store, products: m2Products, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: ['Di'],
  })
  assert.ok(basket.lines.length >= 2)
  return basket
}

function forgedPrototypeFilter(id) {
  const items = []
  const prototype = Object.create(Array.prototype)
  Object.defineProperty(prototype, 'filter', {
    value() { return [id] },
  })
  Object.setPrototypeOf(items, prototype)
  return items
}

function ownGetterSlot(id) {
  const items = [id]
  Object.defineProperty(items, '0', {
    get() { return id },
    enumerable: true,
  })
  return items
}

test('postrepair: inherited filter override cannot invent a completion on empty source (#1341)', () => {
  const basket = current()
  const checked = basket.lines[0].id
  const forged = forgedPrototypeFilter(checked)
  assert.ok(Array.isArray(forged))
  assert.equal(serializeShoppingProgressV2(basket, forged), serializeShoppingProgressV2(basket, []))
  assert.deepEqual(reconcileShoppingProgressV2(basket, basket, forged), [])
  assert.deepEqual(reconcileTrustedShoppingProgressV2(basket, basket, forged), [])
})

test('postrepair: indexed accessor, sparse array and very large list fail closed (#1341)', async (t) => {
  const basket = current()
  const checked = basket.lines[0].id
  const variants = [
    ['indexed accessor', ownGetterSlot(checked)],
    ['sparse one-slot array', new Array(1)],
    ['oversized sparse list', new Array(10001)],
  ]
  for (const [name, list] of variants) {
    await t.test(name, () => {
      assert.equal(serializeShoppingProgressV2(basket, list), null)
      assert.equal(serializeTrustedShoppingProgressV2(basket, list), null)
      assert.deepEqual(reconcileShoppingProgressV2(basket, basket, list), [])
      assert.deepEqual(reconcileTrustedShoppingProgressV2(basket, basket, list), [])
      assert.deepEqual(toggleTrustedShoppingProgressV2(basket, list, checked), [])
    })
  }
})

test('postrepair: dense valid completed IDs remain stable, private and deduplicated (#1341)', () => {
  const basket = current()
  const first = basket.lines[0].id
  const second = basket.lines[1].id
  const input = [second, first, first, 'phantom', null, 0]
  const original = [...input]
  const raw = serializeTrustedShoppingProgressV2(basket, input)
  assert.ok(raw)
  assert.deepEqual(JSON.parse(raw).doneLineIds, [second, first])
  assert.deepEqual(restoreTrustedShoppingProgressV2(basket, raw), [second, first])
  assert.deepEqual(reconcileTrustedShoppingProgressV2(basket, basket, input), [second, first])
  assert.deepEqual(input, original)
})
