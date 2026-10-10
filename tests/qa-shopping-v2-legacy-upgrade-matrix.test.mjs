import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'
import { serializeShoppingListProgress } from '../src/features/shopping-list/shoppingListProgress.ts'
import {
  restoreShoppingProgressV2,
  serializeShoppingProgressV2,
  upgradeLegacyShoppingProgressV1,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

const weeks = [['Ma'], ['Di'], ['Wo'], ['Ma', 'Di'], ['Di', 'Wo'], m2DefaultActiveDays]

function basket(activeDays, products = m2Products) {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays,
    products,
  })
}

test('explicit v1 upgrade accepts exact-current prices but cannot guess equivalence after repricing', () => {
  let repricedMatchedProducts = 0
  for (const days of weeks) {
    const before = basket(days)
    const checked = before.lines.slice(0, 2).map((line) => line.id)
    const legacy = serializeShoppingListProgress(before, checked)
    const migrated = upgradeLegacyShoppingProgressV1(before, legacy)
    assert.ok(migrated, days.join(','))
    assert.deepEqual(restoreShoppingProgressV2(before, migrated), checked)

    for (const product of m2Products) {
      const after = basket(days, m2Products.map((candidate) =>
        candidate.id === product.id
          ? { ...candidate, priceCents: candidate.priceCents + 1 }
          : candidate,
      ))
      const changedPriceOfSelectedItem = before.lines.some(
        (line) => line.status === 'matched' && line.productId === product.id,
      )
      if (!changedPriceOfSelectedItem) continue
      assert.notEqual(after.totalCents, before.totalCents)
      assert.equal(
        upgradeLegacyShoppingProgressV1(after, legacy),
        null,
        `stale v1 snapshot must not upgrade: ${days.join(',')} / ${product.id}`,
      )
      assert.deepEqual(
        restoreShoppingProgressV2(after, migrated),
        checked,
        'once explicitly upgraded on the exact basket, the v2 snapshot survives price refresh',
      )
      repricedMatchedProducts++
    }
  }
  assert.ok(repricedMatchedProducts > 15)
})

test('migration is a separate opt-in action, not an implicit reinterpretation of legacy JSON', () => {
  for (const days of weeks) {
    const before = basket(days)
    const checked = before.lines.slice(0, 2).map((line) => line.id)
    const legacy = serializeShoppingListProgress(before, checked)
    const migrated = upgradeLegacyShoppingProgressV1(before, legacy)
    assert.ok(migrated)
    assert.deepEqual(restoreShoppingProgressV2(before, legacy), [])

    const parsed = JSON.parse(migrated)
    assert.equal(parsed.schemaVersion, 2)
    assert.deepEqual(parsed.doneLineIds, checked)
    assert.notEqual(parsed.demandIdentity, JSON.parse(legacy).basketKey)

    const wrongStore = structuredClone(before)
    wrongStore.store.id = 'not-the-current-store'
    assert.equal(upgradeLegacyShoppingProgressV1(wrongStore, legacy), null)
    assert.deepEqual(restoreShoppingProgressV2(wrongStore, migrated), [])

    const alteredDemand = structuredClone(before)
    alteredDemand.lines[0].requirement.amount += 1
    assert.equal(upgradeLegacyShoppingProgressV1(alteredDemand, legacy), null)
    assert.deepEqual(restoreShoppingProgressV2(alteredDemand, migrated), [])

    const v2Saved = serializeShoppingProgressV2(before, checked)
    assert.ok(v2Saved)
    assert.deepEqual(restoreShoppingProgressV2(before, v2Saved), checked)
    assert.equal(upgradeLegacyShoppingProgressV1(before, v2Saved), null)
  }
})
