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
const fixtureTargets = ['m3-b-basmati-1kg', 'm3-b-chicken-400', 'm3-candidate-store-garam-50']
const syntheticMixCount = recipeIds.length ** m2DefaultActiveDays.length
const negateCents = (value) => value === 0 ? 0 : -value

function planAt(index) {
  let value = index
  return m2InitialPlan.map((meal) => {
    const recipeId = recipeIds[value % recipeIds.length]
    value = Math.floor(value / recipeIds.length)
    return { day: meal.day, recipeId }
  })
}

function basket(store, products, plan) {
  return buildOneStoreBasket({
    store, products, plan, recipes: m2Recipes, activeDays: m2DefaultActiveDays,
  })
}

test('each synthetic 1-cent candidate SKU increase changes comparison only by physically purchased packs', () => {
  for (let mix = 0; mix < syntheticMixCount; mix += 1) {
    const plan = planAt(mix)
    const baseline = basket(m3BaselineStore, m3BaselineProducts, plan)
    const originalCandidate = basket(m3CandidateStore, m3CandidateProducts, plan)
    const original = compareFullBaskets({ baseline, candidate: originalCandidate })
    assert.equal(original.claimable, true, `original recipe mix ${mix}`)

    for (const productId of fixtureTargets) {
      const originalProduct = m3CandidateProducts.find((item) => item.id === productId)
      assert.ok(originalProduct, `synthetic product fixture ${productId}`)
      const pricierProducts = m3CandidateProducts.map((product) =>
        product.id === productId ? { ...product, priceCents: product.priceCents + 1 } : product,
      )
      const pricierCandidate = basket(m3CandidateStore, pricierProducts, plan)
      const pricier = compareFullBaskets({ baseline, candidate: pricierCandidate })
      assert.equal(pricier.claimable, true, `mix ${mix} / ${productId}`)
      const purchasedLine = originalCandidate.lines.find(
        (line) => line.status === 'matched' && line.productId === productId,
      )
      const expectedImpactCents = purchasedLine ? purchasedLine.packs : 0
      assert.equal(
        pricierCandidate.totalCents - originalCandidate.totalCents,
        expectedImpactCents,
        `mix ${mix} / ${productId} purchased packs`,
      )
      assert.equal(pricier.deltaCents - original.deltaCents, expectedImpactCents)
      assert.equal(pricier.savingsCents - original.savingsCents, negateCents(expectedImpactCents))
      assert.equal(pricier.baselineTotalCents, baseline.totalCents)
      assert.deepEqual(
        pricier.lineDeltas.filter(({ id }) => id !== purchasedLine?.id),
        original.lineDeltas.filter(({ id }) => id !== purchasedLine?.id),
      )
    }
  }
})

test('flipping baseline and candidate in each recipe mix reverses the signed economics', () => {
  for (let mix = 0; mix < syntheticMixCount; mix += 1) {
    const plan = planAt(mix)
    const baseline = basket(m3BaselineStore, m3BaselineProducts, plan)
    const candidate = basket(m3CandidateStore, m3CandidateProducts, plan)
    const forward = compareFullBaskets({ baseline, candidate })
    const reverse = compareFullBaskets({ baseline: candidate, candidate: baseline })
    assert.equal(forward.claimable, true)
    assert.equal(reverse.claimable, true)
    assert.equal(forward.deltaCents, negateCents(reverse.deltaCents))
    assert.equal(forward.savingsCents, negateCents(reverse.savingsCents))
    assert.equal(forward.baselineTotalCents, reverse.candidateTotalCents)
    assert.equal(forward.candidateTotalCents, reverse.baselineTotalCents)
    const reverseLineDeltas = new Map(reverse.lineDeltas.map((line) => [line.id, line.deltaCents]))
    for (const line of forward.lineDeltas) {
      assert.equal(line.deltaCents, negateCents(reverseLineDeltas.get(line.id)), `mix ${mix} / ${line.id}`)
    }
    assert.equal(
      reverse.outcome,
      forward.outcome === 'better' ? 'worse' : forward.outcome === 'worse' ? 'better' : 'same',
    )
  }
})
