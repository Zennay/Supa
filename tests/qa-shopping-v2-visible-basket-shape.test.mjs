import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { isTrustworthyShoppingBasket } from '../src/features/shopping-list/shoppingListPhysicalValidity.ts'
import {
  serializeTrustedShoppingProgressV2,
  restoreTrustedShoppingProgressV2,
  reconcileTrustedShoppingProgressV2,
  toggleTrustedShoppingProgressV2,
} from '../src/features/shopping-list/shoppingListTrustedProgressV2.ts'

/**
 * Independent QA against the staged #1093 trusted v2 boundary, not live UI.
 * These are synthetic fixtures. In the canonical basket engine, store.name
 * and each ingredientLabel are nonblank strings; corrupt JSON must not be
 * promoted to a trusted visible shopping task just because pack/cents fit.
 */
function tuesday() {
  const basket = buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: ['Di'],
    products: m2Products,
  })
  assert.equal(basket.unresolvedLineCount, 0)
  assert.ok(basket.lines.length > 1)
  return basket
}

function changeLine(basket, mutate) {
  const copy = structuredClone(basket)
  const line = copy.lines.find((row) => row.status === 'matched')
  assert.ok(line)
  mutate(line)
  return copy
}

test('positive: coherent localized store and ingredient labels do not change the physical task', () => {
  const original = tuesday()
  const checked = [original.lines[0].id]
  const raw = serializeTrustedShoppingProgressV2(original, checked)
  assert.ok(raw)

  const localized = structuredClone(original)
  localized.store.name = 'Voorbeeldwinkel aangepast'
  localized.lines[0].ingredientLabel = 'Ingrediënt op het boodschappenlijstje'
  assert.equal(isTrustworthyShoppingBasket(localized), true)
  assert.deepEqual(restoreTrustedShoppingProgressV2(localized, raw), checked)
  assert.deepEqual(reconcileTrustedShoppingProgressV2(original, localized, checked), checked)
  assert.ok(serializeTrustedShoppingProgressV2(localized, checked))
})

test('negative: malformed displayed retailer and ingredient names never authorize a trusted task', async (t) => {
  const original = tuesday()
  const checked = [original.lines[0].id]
  const raw = serializeTrustedShoppingProgressV2(original, checked)
  assert.ok(raw)

  const mutations = [
    ['missing store name', (basket) => { delete basket.store.name }],
    ['null store name', (basket) => { basket.store.name = null }],
    ['blank store name', (basket) => { basket.store.name = '   ' }],
    ['non-text store name', (basket) => { basket.store.name = { unexpected: true } }],
    ['missing ingredient label', (basket) => { delete basket.lines[0].ingredientLabel }],
    ['null ingredient label', (basket) => { basket.lines[0].ingredientLabel = null }],
    ['blank ingredient label', (basket) => { basket.lines[0].ingredientLabel = '   ' }],
    ['non-text ingredient label', (basket) => { basket.lines[0].ingredientLabel = { unexpected: true } }],
  ]
  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      const bad = structuredClone(original)
      mutate(bad)
      const snapshot = structuredClone(bad)
      assert.equal(isTrustworthyShoppingBasket(bad), false,
        name + ': a corrupt visible basket cannot pass trusted validation')
      assert.equal(serializeTrustedShoppingProgressV2(bad, checked), null,
        name + ': no trustworthy JSON persistence')
      assert.deepEqual(restoreTrustedShoppingProgressV2(bad, raw), [],
        name + ': no restored checkmarks for corrupt current task')
      assert.deepEqual(toggleTrustedShoppingProgressV2(bad, [], checked[0]), [],
        name + ': no new checkmarks for corrupt current task')
      assert.deepEqual(reconcileTrustedShoppingProgressV2(original, bad, checked), [],
        name + ': cannot transfer existing checkmarks into corrupt task')
      assert.deepEqual(reconcileTrustedShoppingProgressV2(bad, original, checked), [],
        name + ': cannot revive state from corrupt prior task')
      assert.deepEqual(bad, snapshot, name + ': QA must not mutate the basket')
    })
  }
})

test('negative: malformed labels on unresolved rows are not trusted either', () => {
  const original = tuesday()
  const partiallyUnresolved = structuredClone(original)
  const line = partiallyUnresolved.lines[0]
  assert.equal(line.status, 'matched')
  partiallyUnresolved.lines[0] = {
    id: line.id,
    ingredientLabel: null,
    requirement: { amount: null, unit: 'unknown' },
    status: 'unresolved',
    reasons: ['no matching product'],
    matchScore: null,
  }
  partiallyUnresolved.matchedLineCount -= 1
  partiallyUnresolved.unresolvedLineCount += 1
  partiallyUnresolved.totalCents -= line.lineTotalCents
  assert.equal(isTrustworthyShoppingBasket(partiallyUnresolved), false)
  assert.equal(serializeTrustedShoppingProgressV2(partiallyUnresolved, []), null)
})
