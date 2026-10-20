import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2InitialPlan, m2DefaultActiveDays, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore,
  m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

const recipeIds = m2Recipes.map(({ id }) => id)
const count = recipeIds.length ** m2DefaultActiveDays.length
function plannedWeek(index) {
  let remaining = index
  return m2InitialPlan.map(({ day }) => {
    const recipeId = recipeIds[remaining % recipeIds.length]
    remaining = Math.floor(remaining / recipeIds.length)
    return { day, recipeId }
  })
}
function build(store, products, plan) {
  return buildOneStoreBasket({
    store, products, plan, recipes: m2Recipes, activeDays: m2DefaultActiveDays,
  })
}
function candidateProductsExcept(products, excludedId) {
  return products.filter(({ id }) => id !== excludedId)
}

test('every M3 recipe mix abstains instead of claiming savings after one actually purchased SKU disappears', () => {
  for (let mix = 0; mix < count; mix += 1) {
    const plan = plannedWeek(mix)
    const baseline = build(m3BaselineStore, m3BaselineProducts, plan)
    const completeCandidate = build(m3CandidateStore, m3CandidateProducts, plan)
    assert.equal(completeCandidate.unresolvedLineCount, 0)
    const purchased = completeCandidate.lines.find((line) => line.status === 'matched')
    assert.ok(purchased, `mix ${mix} contains purchased products`)

    const incompleteCandidate = build(
      m3CandidateStore,
      candidateProductsExcept(m3CandidateProducts, purchased.productId),
      plan,
    )
    const missingLine = incompleteCandidate.lines.find((line) => line.id === purchased.id)
    assert.equal(missingLine?.status, 'unresolved', `mix ${mix} / ${purchased.id}`)
    assert.ok(incompleteCandidate.unresolvedLineCount >= 1)
    assert.ok(incompleteCandidate.totalCents <= completeCandidate.totalCents)
    const result = compareFullBaskets({ baseline, candidate: incompleteCandidate })
    assert.equal(result.claimable, false, `mix ${mix} cannot promote cheaper incomplete cart`)
    assert.equal(result.outcome, 'unknown')
    assert.equal(result.deltaCents, null)
    assert.equal(result.savingsCents, null)
    assert.deepEqual(result.lineDeltas, [])
    assert.match(result.reasons.join(' '), /unresolved ingredients/)
  }
})

test('zero-cent observed-in-fixture SKU is valid money, but negative/unsafe prices cannot fabricate claims', () => {
  for (let mix = 0; mix < count; mix += 1) {
    const plan = plannedWeek(mix)
    const baseline = build(m3BaselineStore, m3BaselineProducts, plan)
    const normalCandidate = build(m3CandidateStore, m3CandidateProducts, plan)
    const target = normalCandidate.lines.find((line) => line.status === 'matched')
    assert.ok(target, `mix ${mix}`)
    const originalComparison = compareFullBaskets({ baseline, candidate: normalCandidate })
    assert.equal(originalComparison.claimable, true)
    const freeProducts = m3CandidateProducts.map((product) =>
      product.id === target.productId ? { ...product, priceCents: 0 } : product,
    )
    const freeCandidate = build(m3CandidateStore, freeProducts, plan)
    assert.equal(freeCandidate.unresolvedLineCount, 0)
    const freeResult = compareFullBaskets({ baseline, candidate: freeCandidate })
    assert.equal(freeResult.claimable, true, `mix ${mix}: zero is not missing`)
    assert.equal(
      freeResult.savingsCents - originalComparison.savingsCents,
      target.lineTotalCents,
      `mix ${mix}: all bought packs count, never a per-item heuristic`,
    )

    for (const invalidPrice of [-1, Number.MAX_SAFE_INTEGER + 1]) {
      const invalidProducts = m3CandidateProducts.map((product) =>
        product.id === target.productId ? { ...product, priceCents: invalidPrice } : product,
      )
      const invalidBasket = build(m3CandidateStore, invalidProducts, plan)
      assert.ok(invalidBasket.unresolvedLineCount >= 1, `mix ${mix} / ${invalidPrice}`)
      const invalidResult = compareFullBaskets({ baseline, candidate: invalidBasket })
      assert.equal(invalidResult.claimable, false)
      assert.equal(invalidResult.outcome, 'unknown')
      assert.equal(invalidResult.savingsCents, null)
      assert.equal(invalidResult.deltaCents, null)
    }
  }
})
