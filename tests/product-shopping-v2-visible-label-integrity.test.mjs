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
} from '../src/features/shopping-list/shoppingListTrustedProgressV2.ts'

function basket() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: ['Di'], products: m2Products,
  })
}

test('valid localized display names do not alter physical task identity or previously checked rows', () => {
  const original = basket()
  const checked = [original.lines[0].id]
  const raw = serializeTrustedShoppingProgressV2(original, checked)
  assert.ok(raw)
  const renamed = structuredClone(original)
  renamed.store.name = '  Lokale winkel  '
  renamed.lines[0].ingredientLabel = '  Verse boodschappen  '
  const before = structuredClone(renamed)

  assert.equal(isPhysicallyTrustworthyShoppingBasket(renamed), true)
  assert.equal(isTrustworthyShoppingBasket(renamed), true)
  assert.equal(shoppingListDemandIdentity(renamed), shoppingListDemandIdentity(original))
  assert.deepEqual(restoreTrustedShoppingProgressV2(renamed, raw), checked)
  assert.deepEqual(reconcileTrustedShoppingProgressV2(original, renamed, checked), checked)
  assert.deepEqual(renamed, before)
})

test('malformed store and matched ingredient labels fail closed for every v2 entry point', async (t) => {
  const original = basket()
  const checked = [original.lines[0].id]
  const raw = serializeTrustedShoppingProgressV2(original, checked)
  assert.ok(raw)
  const mutations = [
    ['missing retailer', (b) => { delete b.store.name }],
    ['null retailer', (b) => { b.store.name = null }],
    ['whitespace retailer', (b) => { b.store.name = '\t  \n' }],
    ['object retailer', (b) => { b.store.name = { key: 'name' } }],
    ['missing ingredient', (b) => { delete b.lines[0].ingredientLabel }],
    ['null ingredient', (b) => { b.lines[0].ingredientLabel = null }],
    ['whitespace ingredient', (b) => { b.lines[0].ingredientLabel = '\n \t' }],
    ['object ingredient', (b) => { b.lines[0].ingredientLabel = ['rice'] }],
  ]
  for (const [name, change] of mutations) await t.test(name, () => {
    const invalid = structuredClone(original)
    change(invalid)
    const snapshot = structuredClone(invalid)
    assert.equal(isPhysicallyTrustworthyShoppingBasket(invalid), false)
    assert.equal(isTrustworthyShoppingBasket(invalid), false)
    assert.equal(shoppingListDemandIdentity(invalid), null)
    assert.equal(serializeTrustedShoppingProgressV2(invalid, checked), null)
    assert.deepEqual(restoreTrustedShoppingProgressV2(invalid, raw), [])
    assert.deepEqual(toggleTrustedShoppingProgressV2(invalid, [], checked[0]), [])
    assert.deepEqual(reconcileTrustedShoppingProgressV2(original, invalid, checked), [])
    assert.deepEqual(reconcileTrustedShoppingProgressV2(invalid, original, checked), [])
    assert.deepEqual(invalid, snapshot)
  })
})

test('unresolved rows also need a readable ingredient label to trust basket progress', () => {
  const changed = structuredClone(basket())
  const prior = changed.lines[0]
  changed.lines[0] = {
    id: prior.id, ingredientLabel: 'Niet beschikbaar',
    requirement: { amount: null, unit: 'unknown' },
    status: 'unresolved', reasons: ['No match'], matchScore: null,
  }
  changed.matchedLineCount--
  changed.unresolvedLineCount++
  changed.totalCents -= prior.lineTotalCents
  assert.equal(isTrustworthyShoppingBasket(changed), true)
  const empty = structuredClone(changed)
  empty.lines[0].ingredientLabel = ''
  assert.equal(isPhysicallyTrustworthyShoppingBasket(empty), false)
  assert.equal(isTrustworthyShoppingBasket(empty), false)
  assert.equal(serializeTrustedShoppingProgressV2(empty, []), null)
})
