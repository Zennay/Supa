import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'
import { isTrustworthyShoppingBasket } from '../src/features/shopping-list/shoppingListPhysicalValidity.ts'

// All values are synthetic. This matrix deliberately exercises the actual
// independent live trust validator AND actual direct text exporter.
function currentBasket(products = m2Products) {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
}
function withChangedLine(basket, index, transform) {
  const mutated = structuredClone(basket)
  mutated.lines[index] = transform(mutated.lines[index])
  return mutated
}

test('matrix: every matched item rejects one extra coherent-but-unneeded physical pack', () => {
  const original = currentBasket()
  assert.equal(isTrustworthyShoppingBasket(original), true)
  const before = structuredClone(original)
  let cases = 0
  for (let index = 0; index < original.lines.length; index++) {
    const line = original.lines[index]
    if (line.status !== 'matched') continue
    const mutated = withChangedLine(original, index, row => ({
      ...row,
      packs: row.packs + 1,
      lineTotalCents: row.lineTotalCents + row.pricePerPackCents,
    }))
    mutated.totalCents += line.pricePerPackCents
    assert.equal(isTrustworthyShoppingBasket(mutated), false, 'live guard ' + line.id)
    assert.equal(buildShoppingListCopyText(mutated), null, 'direct copy guard ' + line.id)
    cases++
  }
  assert.ok(cases >= 4, 'matrix must test multiple actual M2 matched ingredients')
  assert.deepEqual(original, before)
})

test('matrix: line-level coherent metadata still cannot hide a forged basket total', () => {
  const original = currentBasket()
  assert.equal(isTrustworthyShoppingBasket(original), true)
  for (const drift of [-2, -1, 1, 2, 99]) {
    const mutated = { ...original, totalCents: original.totalCents + drift }
    assert.equal(isTrustworthyShoppingBasket(mutated), false, 'live guard drift=' + drift)
    assert.equal(buildShoppingListCopyText(mutated), null, 'copy guard drift=' + drift)
  }
})

test('matrix: verified repricing does not alter copied physical shopping requirements', () => {
  const original = currentBasket()
  const matched = original.lines.find(line => line.status === 'matched')
  assert.ok(matched)
  const originalText = buildShoppingListCopyText(original, [matched.id])
  assert.ok(originalText)
  let cases = 0
  for (const delta of [1, 7, 31, 99]) {
    const updatedProducts = m2Products.map(p => ({ ...p, priceCents: p.priceCents + delta }))
    const updated = currentBasket(updatedProducts)
    assert.equal(isTrustworthyShoppingBasket(updated), true)
    assert.equal(buildShoppingListCopyText(updated, [matched.id]), originalText)
    cases++
  }
  assert.equal(cases, 4)
  assert.doesNotMatch(originalText, /€|bespar|prijsverschil/i)
})

test('matrix: invalid store metadata and stale checked IDs do not escape', () => {
  const original = currentBasket()
  const matched = original.lines.find(line => line.status === 'matched')
  assert.ok(matched)
  for (const invalidId of ['', ' store ', null, 42]) {
    const invalid = { ...original, store: { ...original.store, id: invalidId } }
    assert.equal(buildShoppingListCopyText(invalid), null)
  }
  assert.equal(buildShoppingListCopyText(original, ['nonexistent-ingredient']), null)
  assert.ok(buildShoppingListCopyText(original, [matched.id]).includes('[x]'))
})
