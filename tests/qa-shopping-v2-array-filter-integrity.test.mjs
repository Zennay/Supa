import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  reconcileTrustedShoppingProgressV2,
  serializeTrustedShoppingProgressV2,
  toggleTrustedShoppingProgressV2,
} from '../src/features/shopping-list/shoppingListTrustedProgressV2.ts'
import {
  serializeShoppingProgressV2,
  reconcileShoppingProgressV2,
  toggleShoppingProgressV2,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

function canonical() {
  const basket = buildOneStoreBasket({
    store: m2Store, products: m2Products, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: ['Di'],
  })
  assert.ok(basket.lines.length > 1)
  return basket
}

function forgedFilterArray(id) {
  const input = []
  Object.defineProperty(input, 'filter', {
    value() { return [id] },
    configurable: true,
  })
  return input
}

function inheritedHoleArray(id) {
  const prototype = Object.create(Array.prototype)
  Object.defineProperty(prototype, '0', {
    configurable: true,
    value: id,
  })
  const input = new Array(1)
  Object.setPrototypeOf(input, prototype)
  return input
}

test('QA: caller-owned filter cannot forge a checked row out of an empty completion list (#1341)', () => {
  const basket = canonical()
  const forged = basket.lines[0].id
  const other = basket.lines[1].id

  assert.equal(serializeShoppingProgressV2(basket, forgedFilterArray(forged)), null)
  assert.equal(serializeTrustedShoppingProgressV2(basket, forgedFilterArray(forged)), null)
  assert.deepEqual(reconcileShoppingProgressV2(basket, basket, forgedFilterArray(forged)), [])
  assert.deepEqual(reconcileTrustedShoppingProgressV2(basket, basket, forgedFilterArray(forged)), [])
  assert.deepEqual(toggleShoppingProgressV2(basket, forgedFilterArray(forged), other), [])
  assert.deepEqual(toggleTrustedShoppingProgressV2(basket, forgedFilterArray(forged), other), [])
})

test('QA: inherited array-hole completion ids cannot spoof clicked groceries (#1341)', () => {
  const basket = canonical()
  const forged = basket.lines[0].id

  assert.equal(serializeShoppingProgressV2(basket, inheritedHoleArray(forged)), null)
  assert.equal(serializeTrustedShoppingProgressV2(basket, inheritedHoleArray(forged)), null)
  assert.deepEqual(reconcileShoppingProgressV2(basket, basket, inheritedHoleArray(forged)), [])
  assert.deepEqual(reconcileTrustedShoppingProgressV2(basket, basket, inheritedHoleArray(forged)), [])
})

test('QA: dense primitive arrays preserve valid clicks and ignore unknown ids (#1341)', () => {
  const basket = canonical()
  const valid = basket.lines[0].id
  const input = [valid, valid, 'phantom', null, 7]
  const raw = serializeTrustedShoppingProgressV2(basket, input)
  assert.ok(raw)
  assert.deepEqual(JSON.parse(raw).doneLineIds, [valid])
  assert.deepEqual(reconcileTrustedShoppingProgressV2(basket, basket, input), [valid])
})
