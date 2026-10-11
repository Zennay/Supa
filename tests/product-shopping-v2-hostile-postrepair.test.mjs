import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  isPhysicallyTrustworthyShoppingBasket,
  isTrustworthyShoppingBasket,
} from '../src/features/shopping-list/shoppingListPhysicalValidity.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import {
  restoreTrustedShoppingProgressV2,
  serializeTrustedShoppingProgressV2,
  toggleTrustedShoppingProgressV2,
} from '../src/features/shopping-list/shoppingListTrustedProgressV2.ts'

function currentBasket() {
  const result = buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: ['Di'], products: m2Products,
  })
  assert.equal(isTrustworthyShoppingBasket(result), true)
  assert.equal(result.lines[0].status, 'matched')
  return result
}

function unreadable(item, key) {
  Object.defineProperty(item, key, {
    get() { throw new Error('deliberately unreadable synthetic field') },
    configurable: true,
  })
}

const physicallyUnreadable = [
  ['store identity', (x) => unreadable(x.store, 'id')],
  ['selected meal count', (x) => unreadable(x, 'selectedMealCount')],
  ['unresolved count', (x) => unreadable(x, 'unresolvedLineCount')],
  ['matched count', (x) => unreadable(x, 'matchedLineCount')],
  ['ingredient label', (x) => unreadable(x.lines[0], 'ingredientLabel')],
  ['line status', (x) => unreadable(x.lines[0], 'status')],
  ['selected product identity', (x) => unreadable(x.lines[0], 'productId')],
  ['selected pack size', (x) => unreadable(x.lines[0].pack, 'amount')],
  ['selected pack unit', (x) => unreadable(x.lines[0].pack, 'unit')],
]

test('independent postrepair: unreadable physical fields abstain throughout v2 UI staging (#1337)', async (t) => {
  const valid = currentBasket()
  const checked = valid.lines[0].id
  const saved = serializeTrustedShoppingProgressV2(valid, [checked])
  assert.ok(saved)

  for (const [field, mutate] of physicallyUnreadable) {
    await t.test(field, () => {
      const invalid = structuredClone(valid)
      mutate(invalid)
      assert.equal(isPhysicallyTrustworthyShoppingBasket(invalid), false)
      assert.equal(isTrustworthyShoppingBasket(invalid), false)
      assert.equal(shoppingListDemandIdentity(invalid), null)
      assert.equal(serializeTrustedShoppingProgressV2(invalid, [checked]), null)
      assert.deepEqual(restoreTrustedShoppingProgressV2(invalid, saved), [])
      assert.deepEqual(toggleTrustedShoppingProgressV2(invalid, [checked], checked), [])
    })
  }
})

test('independent postrepair: price-free physical identity never reads hostile cents fields (#1337)', async (t) => {
  const valid = currentBasket()
  const stableIdentity = shoppingListDemandIdentity(valid)
  const checked = valid.lines[0].id
  assert.ok(stableIdentity)

  const priceOnly = [
    ['basket total cents', (x) => unreadable(x, 'totalCents')],
    ['unit pack price cents', (x) => unreadable(x.lines[0], 'pricePerPackCents')],
    ['matched line total cents', (x) => unreadable(x.lines[0], 'lineTotalCents')],
  ]
  for (const [field, mutate] of priceOnly) {
    await t.test(field, () => {
      const invalidMoney = structuredClone(valid)
      mutate(invalidMoney)
      assert.equal(isPhysicallyTrustworthyShoppingBasket(invalidMoney), true)
      assert.equal(shoppingListDemandIdentity(invalidMoney), stableIdentity)
      assert.equal(isTrustworthyShoppingBasket(invalidMoney), false)
      assert.equal(serializeTrustedShoppingProgressV2(invalidMoney, [checked]), null)
      assert.deepEqual(restoreTrustedShoppingProgressV2(invalidMoney, 'anything'), [])
    })
  }
})
