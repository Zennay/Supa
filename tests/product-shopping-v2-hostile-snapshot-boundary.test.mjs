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
  reconcileTrustedShoppingProgressV2,
  restoreTrustedShoppingProgressV2,
  serializeTrustedShoppingProgressV2,
  toggleTrustedShoppingProgressV2,
  upgradeTrustedLegacyProgressV1,
} from '../src/features/shopping-list/shoppingListTrustedProgressV2.ts'

function canonical() {
  const basket = buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: ['Di'], products: m2Products,
  })
  assert.ok(basket.lines.length > 0)
  assert.ok(basket.lines[0].status === 'matched')
  assert.equal(isTrustworthyShoppingBasket(basket), true)
  return basket
}

function throwingProperty(object, property) {
  Object.defineProperty(object, property, {
    configurable: true,
    get() { throw new Error('synthetic accessor must not execute successfully') },
  })
}

function revoked() {
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  return proxy
}

const corruptions = [
  ['revoked basket root', (basket) => revoked()],
  ['revoked store object', (basket) => { basket.store = revoked(); return basket }],
  ['revoked row array', (basket) => { basket.lines = revoked(); return basket }],
  ['revoked matched row', (basket) => { basket.lines[0] = revoked(); return basket }],
  ['revoked matched requirement', (basket) => { basket.lines[0].requirement = revoked(); return basket }],
  ['revoked matched pack', (basket) => { basket.lines[0].pack = revoked(); return basket }],
  ['throwing store property', (basket) => { throwingProperty(basket, 'store'); return basket }],
  ['throwing store name', (basket) => { throwingProperty(basket.store, 'name'); return basket }],
  ['throwing line collection', (basket) => { throwingProperty(basket, 'lines'); return basket }],
  ['throwing matched row id', (basket) => { throwingProperty(basket.lines[0], 'id'); return basket }],
  ['throwing ingredient quantity', (basket) => { throwingProperty(basket.lines[0].requirement, 'amount'); return basket }],
  ['throwing matched pack count', (basket) => { throwingProperty(basket.lines[0].pack, 'count'); return basket }],
]

test('shopping-v2 physical and money gates return false, never throw, for hostile nested snapshots (#1337)', async (t) => {
  for (const [name, corrupt] of corruptions) {
    await t.test(name, () => {
      const malformed = corrupt(structuredClone(canonical()))
      assert.equal(isPhysicallyTrustworthyShoppingBasket(malformed), false)
      assert.equal(isTrustworthyShoppingBasket(malformed), false)
    })
  }
})

test('shopping-v2 identity and all trusted progress operations reject hostile snapshots without throwing (#1337)', async (t) => {
  const good = canonical()
  const checked = good.lines[0].id
  const stored = serializeTrustedShoppingProgressV2(good, [checked])
  assert.ok(stored)
  for (const [name, corrupt] of corruptions) {
    await t.test(name, () => {
      const malformed = corrupt(structuredClone(good))
      assert.equal(shoppingListDemandIdentity(malformed), null)
      assert.equal(serializeTrustedShoppingProgressV2(malformed, [checked]), null)
      assert.deepEqual(restoreTrustedShoppingProgressV2(malformed, stored), [])
      assert.deepEqual(reconcileTrustedShoppingProgressV2(good, malformed, [checked]), [])
      assert.deepEqual(reconcileTrustedShoppingProgressV2(malformed, good, [checked]), [])
      assert.deepEqual(toggleTrustedShoppingProgressV2(malformed, [checked], checked), [])
      assert.equal(upgradeTrustedLegacyProgressV1(malformed, null), null)
    })
  }
})

test('valid complete and empty weeks remain accepted; price-only change preserves trusted checked groceries (#1337)', () => {
  const before = canonical()
  const checked = before.lines[0].id
  const stored = serializeTrustedShoppingProgressV2(before, [checked])
  assert.ok(stored)
  const after = structuredClone(before)
  const matched = after.lines[0]
  assert.equal(matched.status, 'matched')
  matched.pricePerPackCents += 1
  matched.lineTotalCents += matched.packs
  after.totalCents += matched.packs

  assert.equal(isPhysicallyTrustworthyShoppingBasket(after), true)
  assert.equal(isTrustworthyShoppingBasket(after), true)
  assert.equal(shoppingListDemandIdentity(before), shoppingListDemandIdentity(after))
  assert.deepEqual(restoreTrustedShoppingProgressV2(after, stored), [checked])
  assert.deepEqual(reconcileTrustedShoppingProgressV2(before, after, [checked]), [checked])

  const blank = buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: [], products: m2Products,
  })
  assert.equal(isPhysicallyTrustworthyShoppingBasket(blank), true)
  assert.equal(isTrustworthyShoppingBasket(blank), true)
  assert.deepEqual(restoreTrustedShoppingProgressV2(blank, stored), [])
})
