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

// These are controlled fixture prices, NOT actual observations from either
// supermarket. A "claimable" comparator output here is an internal algorithm
// assertion, never permission to advertise observed customer savings.
function evaluate(plan, activeDays = m2DefaultActiveDays) {
  const baseline = buildOneStoreBasket({
    store: m3BaselineStore,
    plan,
    recipes: m2Recipes,
    activeDays,
    products: m3BaselineProducts,
  })
  const candidate = buildOneStoreBasket({
    store: m3CandidateStore,
    plan,
    recipes: m2Recipes,
    activeDays,
    products: m3CandidateProducts,
  })
  return {
    baseline,
    candidate,
    comparison: compareFullBaskets({ baseline, candidate }),
  }
}

function* permutations(items, prefix = []) {
  if (items.length === 0) {
    yield prefix
    return
  }
  for (let i = 0; i < items.length; i += 1) {
    yield* permutations(
      [...items.slice(0, i), ...items.slice(i + 1)],
      [...prefix, items[i]],
    )
  }
}

test('M3 same meal multiset has identical full baskets and signed savings for every weekday assignment', () => {
  const original = evaluate(m2InitialPlan)
  assert.equal(original.comparison.claimable, true)
  assert.equal(original.comparison.savingsCents, 120)

  const dayOrder = m2InitialPlan.map((meal) => meal.day)
  const recipeOrder = m2InitialPlan.map((meal) => meal.recipeId)
  const observedDistinctAssignments = new Set()
  let checked = 0

  for (const assignedRecipes of permutations(recipeOrder)) {
    const reassignedPlan = dayOrder.map((day, index) => ({
      day,
      recipeId: assignedRecipes[index],
    }))
    observedDistinctAssignments.add(assignedRecipes.join(','))
    assert.deepEqual(evaluate(reassignedPlan), original)
    checked += 1
  }

  assert.equal(checked, 24)
  assert.equal(observedDistinctAssignments.size, 12)
})

test('M3 plan-row order and active-day order do not change full-basket economics', () => {
  const original = evaluate(m2InitialPlan)
  let checked = 0

  for (const reorderedPlan of permutations(m2InitialPlan)) {
    // Exercise the two independent orderings: the stored plan list and the
    // active-day picker are UI details, not physical ingredient demand.
    const reorderedDays = reorderedPlan.map((meal) => meal.day).reverse()
    assert.deepEqual(evaluate(reorderedPlan, reorderedDays), original)
    checked += 1
  }

  assert.equal(checked, 24)
})

test('M3 editing an inactive day is inert, but activating it restores its true recipe demand', () => {
  const activeDays = ['Ma', 'Wo']
  const baseline = evaluate(m2InitialPlan, activeDays)
  const changedInactiveDay = m2InitialPlan.map((meal) =>
    meal.day === 'Do' ? { ...meal, recipeId: 'pasta' } : meal,
  )

  assert.deepEqual(evaluate(changedInactiveDay, activeDays), baseline)

  const fullOriginal = evaluate(m2InitialPlan)
  const fullEdited = evaluate(changedInactiveDay)
  assert.notDeepEqual(fullEdited.baseline.lines, fullOriginal.baseline.lines)
  assert.notDeepEqual(fullEdited.candidate.lines, fullOriginal.candidate.lines)
  assert.equal(fullEdited.comparison.claimable, true)
  assert.equal(
    fullEdited.comparison.deltaCents,
    fullEdited.candidate.totalCents - fullEdited.baseline.totalCents,
  )
  assert.equal(
    fullEdited.comparison.savingsCents,
    -fullEdited.comparison.deltaCents,
  )
})
