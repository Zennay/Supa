import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore,
  m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// QA verifies that a foreign-store offer cannot silently alter a user's
// chosen store purchase, even when SKU IDs collide and offer cents are lower.
const recipes = m2Recipes.map(({ id }) => id)
function planFor(index) {
  let value = index
  return m2InitialPlan.map(({ day }) => {
    const recipeId = recipes[value % recipes.length]
    value = Math.floor(value / recipes.length)
    return { day, recipeId }
  })
}
function build(store, products, plan) {
  return buildOneStoreBasket({
    store, products, plan, recipes: m2Recipes, activeDays: m2DefaultActiveDays,
  })
}
function decoys() {
  return [
    ...m3BaselineProducts.map((product) => ({
      ...product, storeId: 'foreign-cheap-store', priceCents: 0,
    })),
    ...m3CandidateProducts.map((product) => ({
      ...product, storeId: 'foreign-cheap-store', priceCents: 0,
    })),
    { ...m3CandidateProducts[0], storeId: 'foreign-cheap-store',
      priceCents: Number.MAX_SAFE_INTEGER + 1 },
  ]
}

test('81 M3 weeks ignore reordered, duplicated and zero-cent foreign retailer listings', () => {
  const baselineCatalog = m3BaselineProducts
  const candidateCatalog = m3CandidateProducts
  const foreign = decoys()
  const combined = [...foreign, ...baselineCatalog, ...candidateCatalog]
  const arrangements = [
    combined,
    [...combined].reverse(),
    [...candidateCatalog, ...foreign, ...baselineCatalog],
    [...baselineCatalog, ...foreign, ...candidateCatalog, ...foreign],
  ]

  for (let mix = 0; mix < recipes.length ** m2DefaultActiveDays.length; mix += 1) {
    const plan = planFor(mix)
    const expectedBaseline = build(m3BaselineStore, baselineCatalog, plan)
    const expectedCandidate = build(m3CandidateStore, candidateCatalog, plan)
    const expectedComparison = compareFullBaskets({
      baseline: expectedBaseline, candidate: expectedCandidate,
    })
    assert.equal(expectedComparison.claimable, true)

    for (let catalogIndex = 0; catalogIndex < arrangements.length; catalogIndex += 1) {
      const products = arrangements[catalogIndex]
      const inputBefore = JSON.stringify(products)
      const baseline = build(m3BaselineStore, products, plan)
      const candidate = build(m3CandidateStore, products, plan)
      const result = compareFullBaskets({ baseline, candidate })
      const context = `week ${mix} catalog ${catalogIndex}`
      assert.deepEqual(baseline, expectedBaseline, `${context}: baseline physical packs`)
      assert.deepEqual(candidate, expectedCandidate, `${context}: candidate physical packs`)
      assert.deepEqual(result, expectedComparison, `${context}: no fabricated savings`)
      assert.equal(JSON.stringify(products), inputBefore, `${context}: input unchanged`)
    }
  }
})

test('foreign zero-cent decoys never resolve genuinely unavailable chosen-store products', () => {
  const foreign = decoys()
  for (const index of [0, 13, 26, 40, 54, 67, 80]) {
    const plan = planFor(index)
    const candidate = build(m3CandidateStore, m3CandidateProducts, plan)
    const first = candidate.lines.find((line) => line.status === 'matched')
    assert.ok(first)
    const missingCatalog = m3CandidateProducts.filter((product) => product.id !== first.productId)
    const chosen = build(m3CandidateStore, [...missingCatalog, ...foreign], plan)
    assert.ok(chosen.unresolvedLineCount > 0, `week ${index}`)
    const baseline = build(m3BaselineStore, m3BaselineProducts, plan)
    const result = compareFullBaskets({ baseline, candidate: chosen })
    assert.equal(result.claimable, false)
    assert.equal(result.outcome, 'unknown')
    assert.equal(result.savingsCents, null)
    assert.equal(result.deltaCents, null)
    assert.deepEqual(result.lineDeltas, [])
  }
})
