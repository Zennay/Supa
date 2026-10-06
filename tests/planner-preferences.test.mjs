import assert from 'node:assert/strict'
import test from 'node:test'

import {
  defaultPlannerPreferences,
  parsePlannerPreferences,
  serializePlannerPreferences,
} from '../src/domain/plannerPreferences.ts'
import {
  m2InitialPlan,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

const recipeIds = m2Recipes.map((recipe) => recipe.id)

test('M2 planner preferences have a deterministic default week', () => {
  assert.deepEqual(defaultPlannerPreferences(m2InitialPlan), {
    budget: 35,
    activeDays: ['Ma', 'Di', 'Wo', 'Do'],
    recipeByDay: {
      Ma: 'tikka',
      Di: 'teriyaki',
      Wo: 'pasta',
      Do: 'tikka',
    },
  })
})

test('M2 planner preferences restore budget, active days and recipe choices', () => {
  const preferences = parsePlannerPreferences(
    JSON.stringify({
      budget: 40,
      activeDays: ['Ma', 'Wo', 'Wo', 'Vr'],
      recipeByDay: {
        Ma: 'pasta',
        Di: 'tikka',
        Wo: 'teriyaki',
        Do: 'pasta',
        Vr: 'tikka',
      },
    }),
    m2InitialPlan,
    recipeIds,
  )

  assert.deepEqual(preferences, {
    budget: 40,
    activeDays: ['Ma', 'Wo'],
    recipeByDay: {
      Ma: 'pasta',
      Di: 'tikka',
      Wo: 'teriyaki',
      Do: 'pasta',
    },
  })
})

test('M2 planner preferences fail closed on stale recipes and invalid budget', () => {
  const preferences = parsePlannerPreferences(
    JSON.stringify({
      budget: -10,
      activeDays: ['Ma', 'Do'],
      recipeByDay: {
        Ma: 'deleted-recipe',
        Di: 'tikka',
      },
    }),
    m2InitialPlan,
    recipeIds,
  )

  assert.equal(preferences.budget, 35)
  assert.deepEqual(preferences.activeDays, ['Ma', 'Do'])
  assert.deepEqual(preferences.recipeByDay, {
    Ma: 'tikka',
    Di: 'tikka',
    Wo: 'pasta',
    Do: 'tikka',
  })
})

test('M2 planner preferences preserve an intentionally empty week', () => {
  const preferences = parsePlannerPreferences(
    JSON.stringify({
      budget: 30,
      activeDays: [],
      recipeByDay: {},
    }),
    m2InitialPlan,
    recipeIds,
  )

  assert.deepEqual(preferences.activeDays, [])
  assert.equal(preferences.budget, 30)
})

test('M2 planner preferences recover when every persisted day is stale', () => {
  const preferences = parsePlannerPreferences(
    JSON.stringify({
      budget: 40,
      activeDays: ['Vr', 'Za'],
      recipeByDay: {},
    }),
    m2InitialPlan,
    recipeIds,
  )

  assert.deepEqual(preferences.activeDays, ['Ma', 'Di', 'Wo', 'Do'])
})

test('M2 planner preferences fall back on malformed storage and round-trip safely', () => {
  const fallback = parsePlannerPreferences(
    '{not-json',
    m2InitialPlan,
    recipeIds,
  )
  assert.deepEqual(fallback, defaultPlannerPreferences(m2InitialPlan))

  const changed = {
    budget: 40,
    activeDays: ['Di', 'Do'],
    recipeByDay: {
      Ma: 'tikka',
      Di: 'pasta',
      Wo: 'pasta',
      Do: 'teriyaki',
    },
  }
  assert.deepEqual(
    parsePlannerPreferences(
      serializePlannerPreferences(changed),
      m2InitialPlan,
      recipeIds,
    ),
    changed,
  )
})


test('M2 planner preferences reject positive budgets the current planner cannot select', () => {
  for (const unsupportedBudget of [33, 0.01, 10_000]) {
    const preferences = parsePlannerPreferences(
      JSON.stringify({
        budget: unsupportedBudget,
        activeDays: ['Ma'],
        recipeByDay: {},
      }),
      m2InitialPlan,
      recipeIds,
    )

    assert.equal(preferences.budget, 35)
  }

  for (const supportedBudget of [30, 35, 40]) {
    const preferences = parsePlannerPreferences(
      JSON.stringify({
        budget: supportedBudget,
        activeDays: ['Ma'],
        recipeByDay: {},
      }),
      m2InitialPlan,
      recipeIds,
    )

    assert.equal(preferences.budget, supportedBudget)
  }
})

test('M2 planner preferences restore active days in canonical planner order', () => {
  const preferences = parsePlannerPreferences(
    JSON.stringify({
      budget: 35,
      activeDays: ['Do', 'Ma', 'Do', 'Wo'],
      recipeByDay: {},
    }),
    m2InitialPlan,
    recipeIds,
  )

  assert.deepEqual(preferences.activeDays, ['Ma', 'Wo', 'Do'])
})

test('M2 planner preferences allow an explicit caller-specific budget contract', () => {
  const preferences = parsePlannerPreferences(
    JSON.stringify({
      budget: 50,
      activeDays: ['Ma'],
      recipeByDay: {},
    }),
    m2InitialPlan,
    recipeIds,
    45,
    [45, 50, 55],
  )

  assert.equal(preferences.budget, 50)
})
