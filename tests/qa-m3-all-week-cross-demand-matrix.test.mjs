import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore,
  m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// Independent M3 QA: same meal-count does NOT establish same physical demand.
// Full 3^4 by 3^4 cross-week study; all fixture prices/catalogs are synthetic.
const recipes = m2Recipes.map(({ id }) => id)
const weekCount = recipes.length ** m2DefaultActiveDays.length

function week(index) {
  let remaining = index
  const plan = m2InitialPlan.map(({ day }) => {
    const recipeId = recipes[remaining % recipes.length]
    remaining = Math.floor(remaining / recipes.length)
    return { day, recipeId }
  })
  const counts = recipes.map((recipeId) =>
    plan.filter((meal) => meal.recipeId === recipeId).length,
  )
  return { plan, fingerprint: counts.join(':') }
}

const weeks = Array.from({ length: weekCount }, (_, index) => week(index))

function baskets(store, products) {
  return weeks.map(({ plan }) => buildOneStoreBasket({
    store, products, plan, recipes: m2Recipes, activeDays: m2DefaultActiveDays,
  }))
}

test('M3 full 81 x 81 comparison matrix refuses financially different recipe multisets', () => {
  assert.equal(weekCount, 81)
  const baseline = baskets(m3BaselineStore, m3BaselineProducts)
  const candidates = baskets(m3CandidateStore, m3CandidateProducts)
  let sameDemandPairs = 0
  let driftPairs = 0

  for (let left = 0; left < weeks.length; left += 1) {
    assert.equal(baseline[left].selectedMealCount, 4)
    assert.equal(baseline[left].unresolvedLineCount, 0)

    for (let right = 0; right < weeks.length; right += 1) {
      assert.equal(candidates[right].selectedMealCount, 4)
      assert.equal(candidates[right].unresolvedLineCount, 0)
      const shouldCompare = weeks[left].fingerprint === weeks[right].fingerprint
      const result = compareFullBaskets({
        baseline: baseline[left],
        candidate: candidates[right],
      })
      const context = `baseline mix ${left} to candidate mix ${right}`

      if (shouldCompare) {
        sameDemandPairs += 1
        assert.equal(result.claimable, true, `${context}: same recipe multiset`)
        assert.equal(result.deltaCents, candidates[right].totalCents - baseline[left].totalCents)
        assert.equal(result.savingsCents, baseline[left].totalCents - candidates[right].totalCents)
        assert.equal(result.lineDeltas.length, baseline[left].matchedLineCount)
        assert.deepEqual(result.reasons, [])
      } else {
        driftPairs += 1
        assert.equal(result.claimable, false, `${context}: different shopping demand`)
        assert.equal(result.outcome, 'unknown', context)
        assert.equal(result.deltaCents, null, context)
        assert.equal(result.savingsCents, null, context)
        assert.deepEqual(result.lineDeltas, [], context)
        assert.match(
          result.reasons.join(' '),
          /ingredient demand differs|ingredient coverage differs|missing ingredient|extra ingredient/,
          context,
        )
      }
    }
  }

  assert.equal(sameDemandPairs + driftPairs, 81 * 81)
  assert.equal(sameDemandPairs, 639, 'same-demand weekday permutations remain comparable')
  assert.equal(driftPairs, 5922, 'remaining equal-meal-count comparisons must abstain')
})

test('M3 week comparison never mutates source recipe, plan or physical basket inputs', () => {
  const baseline = baskets(m3BaselineStore, m3BaselineProducts)
  const candidates = baskets(m3CandidateStore, m3CandidateProducts)
  const before = JSON.stringify({ baseline, candidates, weeks })

  // Cross-shopping context and same-demand comparison both remain pure.
  for (const [left, right] of [[0, 0], [0, 1], [8, 27], [45, 71], [80, 80]]) {
    const outcome = compareFullBaskets({ baseline: baseline[left], candidate: candidates[right] })
    assert.equal(typeof outcome.claimable, 'boolean')
  }
  assert.equal(JSON.stringify({ baseline, candidates, weeks }), before)
})
