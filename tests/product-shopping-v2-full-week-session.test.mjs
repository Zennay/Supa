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
import {
  rebaseShoppingProgressSessionV2,
  startShoppingProgressSessionV2,
  toggleShoppingProgressSessionV2,
} from '../src/features/shopping-list/shoppingListProgressSessionV2.ts'
import { restoreShoppingProgressV2 } from '../src/features/shopping-list/shoppingListProgressV2.ts'

function completeWeek(products = m2Products, activeDays = m2DefaultActiveDays) {
  return buildOneStoreBasket({
    store: m2Store,
    products,
    activeDays,
    plan: m2InitialPlan,
    recipes: m2Recipes,
  })
}

test('actual four-meal weekly basket retains checked rows across every physical-product cent shock', () => {
  const initial = completeWeek()
  assert.equal(initial.selectedMealCount, m2DefaultActiveDays.length)
  assert.ok(initial.lines.length >= 10, 'canonical M2 multi-meal fixture should cover at least 10 demand lines')
  const matched = initial.lines.filter((line) => line.status === 'matched')
  assert.ok(matched.length >= 3)
  const done = matched.slice(0, 3).map((line) => line.id)
  let session = startShoppingProgressSessionV2(initial, null)
  for (const id of done) session = toggleShoppingProgressSessionV2(session, initial, id)
  assert.deepEqual(session.completedLineIds, done)

  for (const shock of [1, 2, 7, 20, 99]) {
    const next = completeWeek(m2Products.map((product) => ({
      ...product,
      priceCents: product.priceCents + shock,
    })))
    const expectedCentDelta = matched.reduce(
      (sum, line) => sum + line.packs * shock,
      0,
    )
    assert.equal(next.totalCents - initial.totalCents, expectedCentDelta)
    const rebased = rebaseShoppingProgressSessionV2(session, next)
    assert.deepEqual(rebased.completedLineIds, done)
    assert.deepEqual(restoreShoppingProgressV2(next, session.serialized), done)
    const reloaded = startShoppingProgressSessionV2(next, session.serialized)
    assert.deepEqual(reloaded.completedLineIds, done)
    assert.equal(reloaded.upgradedFromLegacy, false)
    assert.equal(rebased.demandIdentity, session.demandIdentity)
  }
})

test('multi-meal checklist expires across fewer planned days but not display order', () => {
  const initial = completeWeek()
  const matched = initial.lines.filter((line) => line.status === 'matched')
  const firstId = matched[0].id
  const ticked = toggleShoppingProgressSessionV2(
    startShoppingProgressSessionV2(initial, null), initial, firstId,
  )
  const reversed = structuredClone(initial)
  reversed.lines.reverse()
  assert.deepEqual(rebaseShoppingProgressSessionV2(ticked, reversed).completedLineIds, [firstId])

  const fewerDays = completeWeek(m2Products, m2DefaultActiveDays.slice(0, -1))
  assert.notEqual(fewerDays.selectedMealCount, initial.selectedMealCount)
  const expired = rebaseShoppingProgressSessionV2(ticked, fewerDays)
  assert.deepEqual(expired.completedLineIds, [])
  assert.deepEqual(restoreShoppingProgressV2(fewerDays, ticked.serialized), [])
})

test('matched/unresolved transitions for the same ingredient ID cannot resurrect old checks', () => {
  const initial = completeWeek()
  const matched = initial.lines.find((line) => line.status === 'matched')
  assert.ok(matched)
  const ticked = toggleShoppingProgressSessionV2(
    startShoppingProgressSessionV2(initial, null), initial, matched.id,
  )
  const noLongerMatched = structuredClone(initial)
  const index = noLongerMatched.lines.findIndex((line) => line.id === matched.id)
  noLongerMatched.lines[index] = {
    id: matched.id,
    ingredientLabel: matched.ingredientLabel,
    requirement: { ...matched.requirement },
    status: 'unresolved',
    reasons: ['synthetic: unavailable at the chosen store'],
  }
  noLongerMatched.matchedLineCount--
  noLongerMatched.unresolvedLineCount++
  noLongerMatched.totalCents -= matched.lineTotalCents
  assert.deepEqual(
    rebaseShoppingProgressSessionV2(ticked, noLongerMatched).completedLineIds,
    [],
  )
  assert.deepEqual(restoreShoppingProgressV2(noLongerMatched, ticked.serialized), [])
})
