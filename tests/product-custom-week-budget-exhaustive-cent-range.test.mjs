import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_CUSTOM_WEEK_BUDGET_CENTS,
  customWeekBudgetLabel,
  parseCustomWeekBudget,
  parsePlannerPreferencesWithCustomBudget,
} from '../src/domain/customPlannerBudget.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent product-core evidence on the immutable #1426 acceptance head.
// Every user-selectable cent (not merely representative examples) must survive
// the Dutch input/label cycle, persistence and basket budget arithmetic.
const catalog = m2Recipes.map((recipe) => recipe.id)

test('product: every €0,01–€1.000,00 budget round-trips without fractional-cent drift', () => {
  assert.equal(MAX_CUSTOM_WEEK_BUDGET_CENTS, 100_000)
  for (let cents = 1; cents <= MAX_CUSTOM_WEEK_BUDGET_CENTS; cents++) {
    const amount = cents / 100
    const dutch = customWeekBudgetLabel(amount)
    assert.notEqual(dutch, '', `missing label for ${cents} cents`)
    assert.equal(parseCustomWeekBudget(dutch), amount, `comma ${cents} cents`)
    assert.equal(parseCustomWeekBudget(dutch.replace(',', '.')), amount, `dot ${cents} cents`)
  }
})

test('product: every whole-euro and edge-cent saved budget restores precisely', () => {
  const centsToVerify = new Set([1, 2, 9, 10, 11, 99, 100, 101, 999, 1000, 1001, 1969, 2750, 3500, 4275, 99999, 100000])
  for (let cents = 100; cents <= MAX_CUSTOM_WEEK_BUDGET_CENTS; cents += 100) {
    centsToVerify.add(cents)
  }
  for (const cents of centsToVerify) {
    const budget = cents / 100
    const restored = parsePlannerPreferencesWithCustomBudget(
      JSON.stringify({
        budget,
        activeDays: ['Di'],
        recipeByDay: { Di: 'pasta' },
      }),
      m2InitialPlan,
      catalog,
    )
    assert.equal(restored.budget, budget, `persisted ${cents} cents`)
    assert.deepEqual(restored.activeDays, ['Di'])
    assert.equal(restored.recipeByDay.Di, 'pasta')
  }
})

test('product: cent-native week budget never rounds away €0,01 overspend or minimum-only uncertainty', () => {
  for (let cents = 1; cents <= MAX_CUSTOM_WEEK_BUDGET_CENTS; cents++) {
    const budget = cents / 100
    const underspend = assessPlannerBudgetCents(cents - 1, budget, 0)
    assert.equal(underspend.status, 'known', `underspend ${cents}`)
    assert.equal(underspend.remainingCents, 1, `underspend ${cents}`)
    assert.equal(underspend.overBudget, false, `underspend ${cents}`)

    const overspend = assessPlannerBudgetCents(cents + 1, budget, 0)
    assert.equal(overspend.status, 'known', `overspend ${cents}`)
    assert.equal(overspend.remainingCents, -1, `overspend ${cents}`)
    assert.equal(overspend.overBudget, true, `overspend ${cents}`)
  }

  for (const cents of [1, 1969, 2750, 99999, 100000]) {
    const assessment = assessPlannerBudgetCents(cents + 1, cents / 100, 1)
    assert.equal(assessment.status, 'unknown')
    assert.equal(assessment.reason, 'unresolved-products')
    assert.equal(assessment.knownMinimumCents, cents + 1)
    assert.equal('remainingCents' in assessment, false)
    assert.equal('overBudget' in assessment, false)
  }
})
