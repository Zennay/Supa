import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import {
  serializeShoppingProgressV2,
  restoreShoppingProgressV2,
  reconcileShoppingProgressV2,
  toggleShoppingProgressV2,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Only canonical synthetic M2 products. No actual supermarket observations.
function tuesday() {
  const result = buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: ['Di'], products: m2Products,
  })
  assert.equal(result.unresolvedLineCount, 0)
  assert.ok(result.lines.length > 0)
  return result
}

function alteredMatched(source, modify) {
  const changed = structuredClone(source)
  const line = changed.lines.find((row) => row.status === 'matched')
  assert.ok(line)
  modify(line)
  return changed
}

function assertInvalidPhysicalState(basket, label) {
  const snapshot = structuredClone(basket)
  const checked = basket.lines.map((line) => line.id)
  assert.equal(shoppingListDemandIdentity(basket), null,
    `${label}: a malformed physical basket must not have a trusted persistence key`)
  assert.equal(serializeShoppingProgressV2(basket, checked), null,
    `${label}: malformed basket must not be persisted as if shoppable`)
  assert.deepEqual(restoreShoppingProgressV2(basket,
    JSON.stringify({ schemaVersion: 2, demandIdentity: '', doneLineIds: checked })), [])
  assert.deepEqual(toggleShoppingProgressV2(basket, checked, checked[0]), [],
    `${label}: invalid physical selection cannot be marked complete`)
  assert.deepEqual(basket, snapshot, `${label}: must not mutate untrusted input`)
}

test('positive: canonical physical basket retains ticks despite new price observations', () => {
  const before = tuesday()
  const first = before.lines[0]
  assert.equal(first.status, 'matched')
  const updatedProducts = m2Products.map((product) =>
    product.id === first.productId
      ? { ...product, priceCents: product.priceCents + 5 }
      : product)
  const after = buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: ['Di'], products: updatedProducts,
  })
  assert.ok(shoppingListDemandIdentity(before))
  assert.equal(shoppingListDemandIdentity(before), shoppingListDemandIdentity(after))
  const saved = serializeShoppingProgressV2(before, [first.id])
  assert.ok(saved)
  assert.deepEqual(restoreShoppingProgressV2(after, saved), [first.id])
  assert.deepEqual(reconcileShoppingProgressV2(before, after, [first.id]), [first.id])
})

test('negative: physically incomparable or underfilled product packs must not create v2 checked state', async (t) => {
  const source = tuesday()
  const changes = [
    ['mass demand but litre pack', (line) => { line.pack.unit = 'l' }],
    ['pack shrinks below needed demand', (line) => { line.pack.amount = 0.00001 }],
    ['zero effective pack units', (line) => { line.pack.count = 1; line.pack.amount = Number.MIN_VALUE }],
    ['fabricated extra purchased packs', (line) => { line.packs += 1 }],
    ['effective package quantity overflows', (line) => {
      line.pack.amount = 1e308
      line.pack.count = Number.MAX_SAFE_INTEGER
    }],
  ]
  for (const [label, mutate] of changes) {
    await t.test(label, () => assertInvalidPhysicalState(alteredMatched(source, mutate), label))
  }
})

test('negative: impossible basket counters must not revive trusted checked state', async (t) => {
  const source = tuesday()
  const changes = [
    ['zero selected meals with nonempty shopping task',
      { ...source, selectedMealCount: 0 }],
    ['wrong matched-line count',
      { ...source, matchedLineCount: source.matchedLineCount + 1 }],
    ['negative unresolved-line count',
      { ...source, unresolvedLineCount: -1 }],
    ['nonempty demand with zero selected but forged line count',
      { ...source, selectedMealCount: 0, matchedLineCount: 0 }],
  ]
  for (const [label, changed] of changes) {
    await t.test(label, () => assertInvalidPhysicalState(changed, label))
  }
})
