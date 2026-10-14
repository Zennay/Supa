import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore,
  m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// Product-core matrix: every 4-day arrangement of the three supported recipes,
// including repeated meals. Synthetic fixtures are not real retailer observations.
const recipeIds = m2Recipes.map(({ id }) => id)
const stores = [
  { store: m3BaselineStore, products: m3BaselineProducts },
  { store: m3CandidateStore, products: m3CandidateProducts },
]
const combinations = recipeIds.length ** m2DefaultActiveDays.length

function planFor(index) {
  let remaining = index
  return m2InitialPlan.map(({ day }) => {
    const recipeId = recipeIds[remaining % recipeIds.length]
    remaining = Math.floor(remaining / recipeIds.length)
    return { day, recipeId }
  })
}

function independentlyExpectedDemand(plan) {
  const totals = new Map()
  for (const { recipeId } of plan) {
    const recipe = m2Recipes.find(({ id }) => id === recipeId)
    assert.ok(recipe, `recipe ${recipeId}`)
    for (const ingredient of recipe.ingredients) {
      const existing = totals.get(ingredient.id)
      if (existing) {
        assert.equal(existing.unit, ingredient.unit)
        existing.amount += ingredient.amount
      } else {
        totals.set(ingredient.id, { amount: ingredient.amount, unit: ingredient.unit })
      }
    }
  }
  return totals
}

function toBase(amount, unit) {
  if (unit === 'kg' || unit === 'l') return amount * 1000
  return amount
}

test('M3 physical baskets reconcile for all 81 four-day recipe mixes, including reuse', () => {
  assert.equal(combinations, 81)
  for (let index = 0; index < combinations; index += 1) {
    const plan = planFor(index)
    const expected = independentlyExpectedDemand(plan)
    const baskets = stores.map(({ store, products }) => {
      const basket = buildOneStoreBasket({
        store, products, plan, recipes: m2Recipes, activeDays: m2DefaultActiveDays,
      })
      assert.equal(basket.selectedMealCount, 4, `mix ${index} / ${store.id}`)
      assert.equal(basket.unresolvedLineCount, 0, `mix ${index} / ${store.id}`)
      assert.equal(basket.matchedLineCount, expected.size, `mix ${index} / ${store.id}`)
      assert.equal(basket.lines.length, expected.size, `mix ${index} / ${store.id}`)
      let independentlySummedCents = 0
      for (const line of basket.lines) {
        assert.equal(line.status, 'matched', `mix ${index} / ${line.id}`)
        const demand = expected.get(line.id)
        assert.ok(demand, `mix ${index} unexpected ${line.id}`)
        assert.deepEqual(line.requirement, demand, `mix ${index} / ${line.id}`)
        const product = products.find(({ id }) => id === line.productId)
        assert.ok(product, `mix ${index} missing purchased SKU ${line.productId}`)
        assert.equal(product.storeId, store.id)
        const purchaseAmount = toBase(line.pack.amount * line.pack.count, line.pack.unit)
        const requirementAmount = toBase(demand.amount, demand.unit)
        const expectedPacks = Math.ceil(requirementAmount / purchaseAmount)
        assert.equal(line.packs, expectedPacks, `mix ${index} / ${line.id} minimum packs`)
        assert.equal(line.pricePerPackCents, product.priceCents)
        assert.equal(line.lineTotalCents, expectedPacks * product.priceCents)
        independentlySummedCents += expectedPacks * product.priceCents
      }
      assert.equal(basket.totalCents, independentlySummedCents)
      return basket
    })

    const [baseline, candidate] = baskets
    const comparison = compareFullBaskets({ baseline, candidate })
    assert.equal(comparison.claimable, true, `mix ${index} comparison: ${comparison.reasons}`)
    assert.deepEqual(comparison.reasons, [])
    assert.equal(comparison.lineDeltas.length, expected.size)
    assert.equal(comparison.deltaCents, candidate.totalCents - baseline.totalCents)
    assert.equal(comparison.savingsCents, baseline.totalCents - candidate.totalCents)
    assert.equal(
      comparison.lineDeltas.reduce((sum, line) => sum + line.deltaCents, 0),
      comparison.deltaCents,
      `mix ${index} attribution of full basket line deltas`,
    )
    assert.equal(
      comparison.outcome,
      comparison.deltaCents < 0 ? 'better' : comparison.deltaCents > 0 ? 'worse' : 'same',
    )
  }
})
