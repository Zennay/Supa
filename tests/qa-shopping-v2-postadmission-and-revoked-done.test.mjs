import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { isTrustworthyShoppingBasket } from '../src/features/shopping-list/shoppingListPhysicalValidity.ts'
import {
  reconcileTrustedShoppingProgressV2,
  restoreTrustedShoppingProgressV2,
  serializeTrustedShoppingProgressV2,
  toggleTrustedShoppingProgressV2,
} from '../src/features/shopping-list/shoppingListTrustedProgressV2.ts'

function basket() {
  const value = buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: ['Di'], products: m2Products,
  })
  assert.equal(isTrustworthyShoppingBasket(value), true)
  assert.ok(value.lines.length > 0)
  return value
}

function storeIdFailsAfter(initialReads) {
  const source = structuredClone(basket())
  const originalId = source.store.id
  let reads = 0
  Object.defineProperty(source.store, 'id', {
    configurable: true,
    get() {
      if (++reads > initialReads) throw new Error('synthetic second-phase getter')
      return originalId
    },
  })
  return source
}

function revokedCompletedIds() {
  const { proxy, revoke } = Proxy.revocable([], {})
  revoke()
  return proxy
}

test('shopping-v2 identity must fail closed if a field becomes unreadable after initial validation (#1341)', () => {
  // First read is accepted by physical validation. The second read in
  // the supposedly validated identity builder must not escape as an exception.
  const unstable = storeIdFailsAfter(1)
  assert.equal(shoppingListDemandIdentity(unstable), null)
})

test('trusted v2 persistence rejects late-unreadable store identity without exceptions (#1341)', () => {
  const good = basket()
  const checked = good.lines[0].id
  const saved = serializeTrustedShoppingProgressV2(good, [checked])
  assert.ok(saved)
  // First read: wrapper money-validation. Second: nested physical-validation.
  // Third: identity builder re-read, previously unguarded.
  assert.equal(serializeTrustedShoppingProgressV2(storeIdFailsAfter(2), [checked]), null)
  assert.deepEqual(restoreTrustedShoppingProgressV2(storeIdFailsAfter(2), saved), [])
  assert.deepEqual(reconcileTrustedShoppingProgressV2(good, storeIdFailsAfter(2), [checked]), [])
  assert.deepEqual(toggleTrustedShoppingProgressV2(storeIdFailsAfter(2), [checked], checked), [])
})

test('revoked completion-list arrays never crash trusted v2 mutations (#1341)', () => {
  const current = basket()
  const checked = current.lines[0].id
  assert.equal(serializeTrustedShoppingProgressV2(current, revokedCompletedIds()), null)
  assert.deepEqual(reconcileTrustedShoppingProgressV2(current, current, revokedCompletedIds()), [])
  assert.deepEqual(toggleTrustedShoppingProgressV2(current, revokedCompletedIds(), checked), [])
})

test('normal completion, price-only changes and empty week remain usable (#1341)', () => {
  const current = basket()
  const checked = current.lines[0].id
  const raw = serializeTrustedShoppingProgressV2(current, [checked, checked])
  assert.ok(raw)
  assert.deepEqual(restoreTrustedShoppingProgressV2(current, raw), [checked])

  const repriced = structuredClone(current)
  const line = repriced.lines[0]
  assert.equal(line.status, 'matched')
  line.pricePerPackCents += 1
  line.lineTotalCents += line.packs
  repriced.totalCents += line.packs
  assert.deepEqual(restoreTrustedShoppingProgressV2(repriced, raw), [checked])
  assert.deepEqual(reconcileTrustedShoppingProgressV2(current, repriced, [checked]), [checked])

  const blank = buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: [], products: m2Products,
  })
  assert.equal(isTrustworthyShoppingBasket(blank), true)
  assert.deepEqual(restoreTrustedShoppingProgressV2(blank, raw), [])
})
