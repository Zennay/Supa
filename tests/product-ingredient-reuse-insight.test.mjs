import assert from 'node:assert/strict'
import test from 'node:test'

import { buildIngredientReuseInsight } from '../src/domain/ingredientReuse.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

const input = () => ({
  plan: m2InitialPlan,
  recipes: m2Recipes,
  activeDays: m2DefaultActiveDays,
})

test('real M2 plan exposes the shared ingredients and exact active meal days', () => {
  const result = buildIngredientReuseInsight(input())
  assert.ok(result)
  assert.equal(result.activeMealCount, 4)
  assert.equal(result.distinctIngredientCount, 11)
  assert.deepEqual(result.reusedIngredients.map((row) => [row.ingredientId, row.mealCount]), [
    ['basmati-rice', 3],
    ['cauliflower', 2],
    ['chicken-thigh', 2],
    ['coconut-milk', 2],
    ['garam-masala', 2],
  ])
  const rice = result.reusedIngredients[0]
  assert.equal(rice.label, 'Basmati rijst')
  assert.deepEqual(rice.days, ['Ma', 'Di', 'Do'])
  assert.deepEqual(rice.recipeIds, ['tikka', 'teriyaki', 'tikka'])
  assert.equal(Object.hasOwn(rice, 'savingsCents'), false)
  assert.equal(Object.hasOwn(rice, 'remainingAmount'), false)
})

test('turning off an active day removes its reuse without retaining stale plan claims', () => {
  const result = buildIngredientReuseInsight({
    ...input(),
    activeDays: ['Di', 'Wo'],
  })
  assert.ok(result)
  assert.equal(result.activeMealCount, 2)
  assert.equal(result.reusedIngredients.length, 0)
})

test('choosing a different recipe changes reuse even if an old result still exists', () => {
  const original = buildIngredientReuseInsight(input())
  const next = buildIngredientReuseInsight({
    ...input(),
    plan: m2InitialPlan.map((meal) =>
      meal.day === 'Do' ? { ...meal, recipeId: 'pasta' } : meal,
    ),
  })
  assert.ok(original)
  assert.ok(next)
  assert.ok(original.reusedIngredients.some((row) => row.ingredientId === 'chicken-thigh'))
  assert.equal(next.reusedIngredients.some((row) => row.ingredientId === 'chicken-thigh'), false)
  assert.deepEqual(
    next.reusedIngredients.map((row) => row.ingredientId),
    ['basmati-rice', 'greek-yogurt', 'spaghetti', 'tomato-cubes'],
  )
})

test('an ingredient repeated within one recipe counts once per meal, not twice', () => {
  const recipe = {
    id: 'double',
    title: 'Twee stappen',
    minutes: 20,
    servings: 1,
    estimatedCost: 2,
    tags: [],
    ingredients: [
      { id: 'rice', label: 'Rijst', query: 'rijst', amount: 50, unit: 'g' },
      { id: 'rice', label: 'Rijst', query: 'rijst', amount: 50, unit: 'g' },
    ],
  }
  const oneDay = buildIngredientReuseInsight({
    plan: [{ day: 'Ma', recipeId: 'double' }],
    recipes: [recipe],
    activeDays: ['Ma'],
  })
  assert.ok(oneDay)
  assert.deepEqual(oneDay.reusedIngredients, [])

  const twoDays = buildIngredientReuseInsight({
    plan: [
      { day: 'Ma', recipeId: 'double' },
      { day: 'Di', recipeId: 'double' },
    ],
    recipes: [recipe],
    activeDays: ['Ma', 'Di'],
  })
  assert.ok(twoDays)
  assert.deepEqual(twoDays.reusedIngredients, [{
    ingredientId: 'rice',
    label: 'Rijst',
    days: ['Ma', 'Di'],
    recipeIds: ['double', 'double'],
    mealCount: 2,
  }])
})

test('active-day ordering controls explanation chronology; no input is mutated', () => {
  const originalSnapshot = JSON.stringify(input())
  const first = buildIngredientReuseInsight({
    ...input(),
    activeDays: ['Do', 'Wo', 'Di', 'Ma'],
  })
  const second = buildIngredientReuseInsight({
    ...input(),
    activeDays: ['Do', 'Wo', 'Di', 'Ma'],
  })
  assert.ok(first)
  assert.deepEqual(first, second)
  assert.deepEqual(first.reusedIngredients[0].days, ['Do', 'Di', 'Ma'])
  assert.equal(JSON.stringify(input()), originalSnapshot)
})

test('rejects empty, incomplete, ambiguous, inconsistent and invalid quantity plans', () => {
  const scenarios = [
    { ...input(), activeDays: [] },
    { ...input(), activeDays: ['Ma', 'Ma'] },
    { ...input(), activeDays: ['Ma', 'Onbekend'] },
    { ...input(), plan: [...m2InitialPlan, { day: 'Ma', recipeId: 'pasta' }] },
    { ...input(), plan: [{ day: 'Ma', recipeId: 'missing' }], activeDays: ['Ma'] },
    { ...input(), recipes: [...m2Recipes, m2Recipes[0]] },
    {
      ...input(),
      recipes: m2Recipes.map((recipe) => recipe.id === 'teriyaki'
        ? { ...recipe, ingredients: [{ ...recipe.ingredients[0], label: 'Niet dezelfde rijst' }] }
        : recipe),
    },
    {
      ...input(),
      recipes: m2Recipes.map((recipe) => recipe.id === 'teriyaki'
        ? { ...recipe, ingredients: [{ ...recipe.ingredients[0], amount: null }] }
        : recipe),
    },
    {
      ...input(),
      recipes: m2Recipes.map((recipe) => recipe.id === 'teriyaki'
        ? { ...recipe, ingredients: [{ ...recipe.ingredients[0], unit: 'light-years' }] }
        : recipe),
    },
    {
      ...input(),
      recipes: m2Recipes.map((recipe) => recipe.id === 'teriyaki'
        ? { ...recipe, ingredients: [{ ...recipe.ingredients[0], unit: 'kg' }] }
        : recipe),
    },
    { ...input(), activeDays: null },
    { ...input(), recipes: null },
    { ...input(), plan: null },
  ]
  for (const scenario of scenarios) {
    assert.equal(buildIngredientReuseInsight(scenario), null)
  }
})
