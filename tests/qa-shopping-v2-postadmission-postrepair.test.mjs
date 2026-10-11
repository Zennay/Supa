import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import {
  serializeShoppingProgressV2,
  reconcileShoppingProgressV2,
  toggleShoppingProgressV2,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'
import {
  serializeTrustedShoppingProgressV2,
  reconcileTrustedShoppingProgressV2,
  toggleTrustedShoppingProgressV2,
} from '../src/features/shopping-list/shoppingListTrustedProgressV2.ts'

function basket() {
  const result = buildOneStoreBasket({
    store: m2Store, recipes: m2Recipes, products: m2Products,
    plan: m2InitialPlan, activeDays: ['Di'],
  })
  assert.ok(result.lines.length > 0)
  assert.ok(result.lines[0].status === 'matched')
  return result
}

function lateLineIdFailure(allowedReads) {
  const source = structuredClone(basket())
  const line = source.lines[0]
  const original = line.id
  let reads = 0
  Object.defineProperty(line, 'id', {
    configurable: true,
    get() {
      if (++reads > allowedReads) throw new Error('synthetic post-check line id')
      return original
    },
  })
  return source
}

function hostileDoneArray(kind) {
  if (kind === 'revoked') {
    const { proxy, revoke } = Proxy.revocable([], {})
    revoke()
    return proxy
  }
  if (kind === 'index getter') {
    const values = ['valid']
    Object.defineProperty(values, '0', {
      get() { throw new Error('synthetic completed-id getter') },
    })
    return values
  }
  const values = ['valid']
  Object.defineProperty(values, 'filter', {
    get() { throw new Error('synthetic completion filter getter') },
  })
  return values
}

test('independent postrepair: nested line identity becomes unreadable only after validation (#1341)', () => {
  // Each matched line-id is observed three times in physical validation,
  // then the identity projection must refuse any later thrown read.
  assert.equal(shoppingListDemandIdentity(lateLineIdFailure(3)), null)
  const current = basket()
  const checked = current.lines[0].id
  // Wrapper first validates money, then the identity builder validates physical.
  assert.equal(serializeTrustedShoppingProgressV2(lateLineIdFailure(6), [checked]), null)
  assert.deepEqual(reconcileTrustedShoppingProgressV2(current, lateLineIdFailure(6), [checked]), [])
  assert.deepEqual(toggleTrustedShoppingProgressV2(lateLineIdFailure(6), [checked], checked), [])
})

test('independent postrepair: 3 caller-owned completion-array failure variants fail closed (#1341)', async (t) => {
  const current = basket()
  const checked = current.lines[0].id
  for (const kind of ['revoked', 'index getter', 'filter getter']) {
    await t.test(kind, () => {
      assert.equal(serializeShoppingProgressV2(current, hostileDoneArray(kind)), null)
      assert.equal(serializeTrustedShoppingProgressV2(current, hostileDoneArray(kind)), null)
      assert.deepEqual(reconcileShoppingProgressV2(current, current, hostileDoneArray(kind)), [])
      assert.deepEqual(reconcileTrustedShoppingProgressV2(current, current, hostileDoneArray(kind)), [])
      assert.deepEqual(toggleShoppingProgressV2(current, hostileDoneArray(kind), checked), [])
      assert.deepEqual(toggleTrustedShoppingProgressV2(current, hostileDoneArray(kind), checked), [])
    })
  }
})

test('independent postrepair: normal valid checked list keeps price-stable identity (#1341)', () => {
  const original = basket()
  const checked = original.lines[0].id
  const saved = serializeTrustedShoppingProgressV2(original, [checked, checked, 'phantom'])
  assert.ok(saved)
  assert.deepEqual(JSON.parse(saved).doneLineIds, [checked])
  const repriced = structuredClone(original)
  const priced = repriced.lines[0]
  assert.equal(priced.status, 'matched')
  priced.pricePerPackCents += 1
  priced.lineTotalCents += priced.packs
  repriced.totalCents += priced.packs

  assert.equal(shoppingListDemandIdentity(original), shoppingListDemandIdentity(repriced))
  assert.deepEqual(reconcileTrustedShoppingProgressV2(original, repriced, [checked]), [checked])
  const otherStore = structuredClone(original)
  otherStore.store.id = 'different-store'
  assert.deepEqual(reconcileTrustedShoppingProgressV2(original, otherStore, [checked]), [])
})
