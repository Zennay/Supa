import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Recipes,
} from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts,
  m3BaselineStore,
  m3CandidateProducts,
  m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// Synthetic fixture assurance only. This is not a real PLUS/DekaMarkt field observation.
const recipeChoices = m2Recipes.map((recipe) => recipe.id)
function allPlannerRecipeChoices(plan, recipeIds) {
  return plan.reduce(
    (variants, meal) =>
      variants.flatMap((variant) =>
        recipeIds.map((recipeId) => ({
          name: variant.name ? `${variant.name},${recipeId}` : recipeId,
          meals: [...variant.meals, { ...meal, recipeId }],
        })),
      ),
    [{ name: '', meals: [] }],
  )
}

const planVariants = allPlannerRecipeChoices(m2InitialPlan, recipeChoices)

function nonemptyDaySubsets(days) {
  return Array.from({ length: (1 << days.length) - 1 }, (_, index) => {
    const mask = index + 1
    return days.filter((_, dayIndex) => (mask & (1 << dayIndex)) !== 0)
  })
}

function basketFor(store, products, plan, activeDays) {
  return buildOneStoreBasket({
    store,
    products,
    plan,
    activeDays,
    recipes: m2Recipes,
  })
}

test('M3 synthetic product flow keeps equivalent demand across every active-day subset and recipe variant', () => {
  const daySubsets = nonemptyDaySubsets(m2DefaultActiveDays)
  let evaluated = 0

  for (const { name, meals } of planVariants) {
    for (const activeDays of daySubsets) {
      const context = `${name} / ${activeDays.join(',')}`
      const baseline = basketFor(
        m3BaselineStore,
        m3BaselineProducts,
        meals,
        activeDays,
      )
      const candidate = basketFor(
        m3CandidateStore,
        m3CandidateProducts,
        meals,
        activeDays,
      )
      const result = compareFullBaskets({ baseline, candidate })

      assert.equal(baseline.selectedMealCount, activeDays.length, context)
      assert.equal(candidate.selectedMealCount, activeDays.length, context)
      assert.equal(baseline.unresolvedLineCount, 0, context)
      assert.equal(candidate.unresolvedLineCount, 0, context)
      assert.equal(result.claimable, true, `${context}: ${result.reasons.join('; ')}`)
      assert.equal(result.outcome, 'better', context)
      assert.ok(result.savingsCents > 0, context)
      assert.equal(result.deltaCents, candidate.totalCents - baseline.totalCents, context)
      assert.equal(result.savingsCents, result.deltaCents === 0 ? 0 : -result.deltaCents, context)
      assert.equal(result.lineDeltas.length, baseline.matchedLineCount, context)
      assert.deepEqual(
        baseline.lines.map(({ id, requirement }) => ({ id, requirement })),
        candidate.lines.map(({ id, requirement }) => ({ id, requirement })),
        context,
      )
      assert.equal(
        result.lineDeltas.reduce((total, line) => total + line.deltaCents, 0),
        result.deltaCents,
        context,
      )
      evaluated += 1
    }
  }

  assert.equal(daySubsets.length, 15)
  assert.equal(planVariants.length, recipeChoices.length ** m2InitialPlan.length)
  assert.equal(evaluated, 15 * (recipeChoices.length ** m2InitialPlan.length))
})

test('M3 full-basket results stay neutral or honestly worse across all synthetic planner choices', () => {
  const priceByName = new Map(m3BaselineProducts.map((product) => [
    product.name,
    product.priceCents,
  ]))
  assert.equal(priceByName.size, m3BaselineProducts.length)

  for (const { name, meals } of planVariants) {
    for (const activeDays of nonemptyDaySubsets(m2DefaultActiveDays)) {
      const baseline = basketFor(
        m3BaselineStore,
        m3BaselineProducts,
        meals,
        activeDays,
      )
      const context = `${name} / ${activeDays.join(',')}`

      for (const { surchargeCents, expectedOutcome } of [
        { surchargeCents: 0, expectedOutcome: 'same' },
        { surchargeCents: 25, expectedOutcome: 'worse' },
      ]) {
        const candidateProducts = m3CandidateProducts.map((product) => {
          const baselinePriceCents = priceByName.get(product.name)
          assert.notEqual(baselinePriceCents, undefined, product.name)
          return {
            ...product,
            priceCents: baselinePriceCents + surchargeCents,
          }
        })
        const candidate = basketFor(
          m3CandidateStore,
          candidateProducts,
          meals,
          activeDays,
        )
        const result = compareFullBaskets({ baseline, candidate })

        assert.equal(candidate.unresolvedLineCount, 0, context)
        assert.equal(result.claimable, true, `${context}: ${result.reasons.join('; ')}`)
        assert.equal(result.outcome, expectedOutcome, context)
        assert.equal(result.deltaCents, candidate.totalCents - baseline.totalCents, context)
        assert.equal(result.savingsCents, result.deltaCents === 0 ? 0 : -result.deltaCents, context)
        assert.equal(
          result.lineDeltas.reduce((sum, line) => sum + line.deltaCents, 0),
          result.deltaCents,
          context,
        )
        if (expectedOutcome === 'same') {
          assert.equal(result.savingsCents, 0, context)
        } else {
          assert.ok(result.savingsCents < 0, context)
          assert.ok(result.deltaCents > 0, context)
        }
      }
    }
  }
})

test('M3 synthetic product flow abstains when a valid planned basket loses a candidate product', () => {
  const plan = planVariants.find(({ meals }) =>
    new Set(meals.map((meal) => meal.recipeId)).size > 1,
  )?.meals
  assert.ok(plan)
  const activeDays = m2DefaultActiveDays
  const baseline = basketFor(m3BaselineStore, m3BaselineProducts, plan, activeDays)
  const completeCandidate = basketFor(
    m3CandidateStore,
    m3CandidateProducts,
    plan,
    activeDays,
  )
  assert.equal(completeCandidate.unresolvedLineCount, 0)

  const requiredProductId = completeCandidate.lines.find(
    (line) => line.status === 'matched',
  )?.productId
  assert.ok(requiredProductId)

  const candidate = basketFor(
    m3CandidateStore,
    m3CandidateProducts.filter((product) => product.id !== requiredProductId),
    plan,
    activeDays,
  )
  const result = compareFullBaskets({ baseline, candidate })

  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
  assert.ok(result.reasons.length > 0)
})
