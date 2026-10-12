import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'
import {
  startShoppingProgressSessionV2,
  rebaseShoppingProgressSessionV2,
  toggleShoppingProgressSessionV2,
} from '../src/features/shopping-list/shoppingListProgressSessionV2.ts'

function basket() {
  return buildOneStoreBasket({
    store: { ...m2Store }, plan: m2InitialPlan,
    recipes: m2Recipes, products: m2Products,
    activeDays: ['Di'],
  })
}

test('QA: rendered v2 rows never borrow stale physical checks during an in-place store change', () => {
  const current = basket()
  const previousPhysicalKey = shoppingListDemandIdentity(current)
  assert.equal(typeof previousPhysicalKey, 'string')

  const first = shoppingListRowsV2(current, startShoppingProgressSessionV2(current, null))[0]
  assert.ok(first)
  const checked = toggleShoppingProgressSessionV2(
    startShoppingProgressSessionV2(current, null), current, first.id,
  )
  assert.ok(shoppingListRowsV2(current, checked).find((row) => row.id === first.id)?.checked)
  assert.equal(checked.completedLineIds.length, 1)

  // Simulates an in-place React prop edit before the component's passive effect.
  current.store.id = 'synthetic-other-store'
  assert.notEqual(shoppingListDemandIdentity(current), previousPhysicalKey)
  const duringTransition = shoppingListRowsV2(current, checked)
  assert.ok(duringTransition.length > 0)
  assert.equal(duringTransition.some((row) => row.checked), false)
  const rebased = rebaseShoppingProgressSessionV2(checked, current)
  assert.deepEqual(rebased.completedLineIds, [])
  assert.equal(shoppingListRowsV2(current, rebased).some((row) => row.checked), false)
})

test('QA: a changed price or readable product label preserves physical checkbox identity', () => {
  const original = basket()
  const line = original.lines.find((item) => item.status === 'matched')
  assert.ok(line)
  const selected = toggleShoppingProgressSessionV2(
    startShoppingProgressSessionV2(original, null), original, line.id,
  )
  const changed = structuredClone(original)
  const oldIdentity = shoppingListDemandIdentity(original)
  const originalBefore = structuredClone(original)
  changed.totalCents += 135
  changed.lines.find((item) => item.id === line.id).productName = 'Nieuw schapkaartje'

  assert.equal(shoppingListDemandIdentity(changed), oldIdentity)
  const visible = shoppingListRowsV2(changed, selected)
  assert.ok(visible.find((row) => row.id === line.id)?.checked)
  assert.equal(visible.find((row) => row.id === line.id)?.label, 'Nieuw schapkaartje')
  assert.ok(visible.every((row) => !/€/.test(row.quantity)))
  assert.deepEqual(original, originalBefore)
})

test('QA: invalidated product identity suppresses both rendered rows and saveable progress', () => {
  const current = basket()
  const line = current.lines.find((item) => item.status === 'matched')
  assert.ok(line)
  const checked = toggleShoppingProgressSessionV2(
    startShoppingProgressSessionV2(current, null), current, line.id,
  )
  const invalid = structuredClone(current)
  invalid.lines.find((item) => item.id === line.id).productName = '\u2800'
  const invalidBefore = structuredClone(invalid)

  assert.equal(shoppingListDemandIdentity(invalid), null)
  assert.deepEqual(shoppingListRowsV2(invalid, checked), [])
  const afterToggle = toggleShoppingProgressSessionV2(checked, invalid, line.id)
  assert.equal(afterToggle.demandIdentity, null)
  assert.equal(afterToggle.serialized, null)
  assert.deepEqual(afterToggle.completedLineIds, [])
  assert.deepEqual(invalid, invalidBefore)
})
