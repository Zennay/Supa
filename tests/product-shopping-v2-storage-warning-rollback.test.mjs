import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'

const basket = () => buildOneStoreBasket({
  store: m2Store, products: m2Products, plan: m2InitialPlan,
  activeDays: ['Di'], recipes: m2Recipes,
})

test('a denied reset can restore old checkmarks after reload, so user-facing save feedback must describe that risk', () => {
  const first = basket()
  const picked = first.lines.find((line) => line.status === 'matched')
  assert.ok(picked)
  const saved = new Map()
  let failWrites = false
  const port = {
    getItem(key) { return saved.get(key) ?? null },
    setItem(key, value) {
      if (failWrites) throw new Error('synthetic storage quota')
      saved.set(key, value)
    },
  }

  const before = openShoppingProgressStorageV2(first, port)
  before.toggle(picked.id)
  assert.equal(before.persist(), true)
  assert.deepEqual(JSON.parse(saved.get(shoppingListProgressV2StorageKey)).doneLineIds, [picked.id])

  failWrites = true
  const cleared = before.clear()
  assert.deepEqual(cleared.completedLineIds, [], 'clear takes effect in memory')
  assert.equal(before.persist(), false, 'clear was not saved')
  assert.deepEqual(
    openShoppingProgressStorageV2(first, port).snapshot().completedLineIds,
    [picked.id],
    'reload can restore the old checked item when an explicit clear could not persist',
  )

  // UI is TypeScript/JSX. Assert the source of the real view retains a
  // nonmisleading error message instead of inventing a fake React interaction.
  const component = readFileSync(
    new URL('../src/features/shopping-list/ShoppingListViewV2.tsx', import.meta.url), 'utf8',
  )
  assert.match(component, /\{saveFailed && \(/)
  assert.match(component, /role="status"/)
  assert.match(
    component,
    /Na herladen kunnen oude vinkjes terugkomen of nieuwe vinkjes verdwijnen\./,
    'the view must warn about both reset rollback and unsaved new checks',
  )
  assert.doesNotMatch(
    component,
    /Je vinkjes blijven in deze sessie, maar kunnen na herladen verdwijnen\./,
    'old error text incorrectly suggested a clear cannot be undone by failed storage',
  )
})
