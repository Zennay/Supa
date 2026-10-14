import assert from 'node:assert/strict'
import test from 'node:test'
import { previewRecipeReuseChange } from '../src/domain/ingredientReusePreview.ts'
import { buildIngredientReuseInsight } from '../src/domain/ingredientReuse.ts'
import {
  m2InitialPlan,
  m2DefaultActiveDays,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

const args = () => ({
  plan: m2InitialPlan,
  recipes: m2Recipes,
  activeDays: m2DefaultActiveDays,
  day: 'Do',
  recipeId: 'pasta',
})

test('preview of Thursday tikka → pasta reports newly shared, lost and changed overlap', () => {
  const result = previewRecipeReuseChange(args())
  assert.ok(result)
  assert.equal(result.previousRecipeId, 'tikka')
  assert.equal(result.nextRecipeId, 'pasta')
  assert.equal(result.beforeSharedCount, 5)
  assert.equal(result.afterSharedCount, 4)
  assert.deepEqual(result.newlyShared.map((row) => row.ingredientId), [
    'greek-yogurt', 'spaghetti', 'tomato-cubes',
  ])
  assert.deepEqual(result.noLongerShared.map((row) => row.ingredientId), [
    'cauliflower', 'chicken-thigh', 'coconut-milk', 'garam-masala',
  ])
  assert.deepEqual(result.changedShared.map((row) => row.ingredientId), [
    'basmati-rice',
  ])
  const rice = result.changedShared[0]
  assert.equal(rice.beforeSharedMealCount, 3)
  assert.equal(rice.afterSharedMealCount, 2)
  assert.deepEqual(rice.beforeDays, ['Ma', 'Di', 'Do'])
  assert.deepEqual(rice.afterDays, ['Ma', 'Di'])
  const pasta = result.newlyShared.find((row) => row.ingredientId === 'spaghetti')
  assert.ok(pasta)
  // A no-longer-shared ingredient may still appear in one meal. The helper
  // never invents a zero-occurrence claim.
  assert.equal(pasta.beforeSharedMealCount, null)
  assert.equal(pasta.afterSharedMealCount, 2)
  assert.deepEqual(pasta.afterDays, ['Wo', 'Do'])
  const chicken = result.noLongerShared.find((row) => row.ingredientId === 'chicken-thigh')
  assert.equal(chicken.beforeSharedMealCount, 2)
  assert.equal(chicken.afterSharedMealCount, null)
})

test('preview does not modify the active week or silently apply the recipe change', () => {
  const before = JSON.stringify(args())
  const first = previewRecipeReuseChange(args())
  const second = previewRecipeReuseChange(args())
  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(args()), before)
  assert.equal(m2InitialPlan.find((meal) => meal.day === 'Do').recipeId, 'tikka')
  for (const key of ['priceCents','savingsCents','packs','leftoverAmount','budget','estimatedCost']) {
    assert.equal(JSON.stringify(first).includes(key), false)
  }
})

test('choosing the current recipe is a valid no-op without invented reuse', () => {
  const noOp = previewRecipeReuseChange({ ...args(), recipeId: 'tikka' })
  assert.ok(noOp)
  assert.equal(noOp.beforeSharedCount, noOp.afterSharedCount)
  assert.deepEqual(noOp.newlyShared, [])
  assert.deepEqual(noOp.noLongerShared, [])
  assert.deepEqual(noOp.changedShared, [])
})

test('inactive, empty, duplicate, missing and mismatched plan inputs fail closed', () => {
  const checks = [
    { ...args(), activeDays: [] },
    { ...args(), activeDays: ['Ma', 'Di'] },
    { ...args(), activeDays: ['Ma','Do','Do'] },
    { ...args(), day: 'Unknown' },
    { ...args(), day: '' },
    { ...args(), day: null },
    { ...args(), recipeId: 'does-not-exist' },
    { ...args(), recipeId: '' },
    { ...args(), recipeId: 1 },
    { ...args(), recipes: [...m2Recipes, m2Recipes[2]] },
    { ...args(), plan: m2InitialPlan.filter((meal) => meal.day !== 'Do') },
    { ...args(), plan: [...m2InitialPlan, { day: 'Do', recipeId: 'pasta' }] },
    { ...args(), activeDays: null },
    { ...args(), plan: null },
    { ...args(), recipes: null },
  ]
  for (const input of checks) {
    assert.equal(previewRecipeReuseChange(input), null)
  }
})

test('every active-day and recipe choice returns a preview consistent with canonical replan', () => {
  let count = 0
  const allDays = m2DefaultActiveDays
  for (let mask = 1; mask < 1 << allDays.length; mask++) {
    const activeDays = allDays.filter((_, index) => (mask & (1 << index)) !== 0)
    for (const day of activeDays) {
      for (const recipe of m2Recipes) {
        const result = previewRecipeReuseChange({
          ...args(), activeDays, day, recipeId: recipe.id,
        })
        assert.ok(result)
        const changedPlan = m2InitialPlan.map((meal) =>
          meal.day === day ? { ...meal, recipeId: recipe.id } : meal,
        )
        const oldInsight = buildIngredientReuseInsight({
          plan: m2InitialPlan, recipes: m2Recipes, activeDays,
        })
        const newInsight = buildIngredientReuseInsight({
          plan: changedPlan, recipes: m2Recipes, activeDays,
        })
        assert.ok(oldInsight)
        assert.ok(newInsight)
        assert.equal(result.beforeSharedCount, oldInsight.reusedIngredients.length)
        assert.equal(result.afterSharedCount, newInsight.reusedIngredients.length)
        const oldIds = new Set(oldInsight.reusedIngredients.map((item) => item.ingredientId))
        const newIds = new Set(newInsight.reusedIngredients.map((item) => item.ingredientId))
        assert.deepEqual(
          result.newlyShared.map((row) => row.ingredientId),
          [...newIds].filter((id) => !oldIds.has(id)).sort(),
        )
        assert.deepEqual(
          result.noLongerShared.map((row) => row.ingredientId),
          [...oldIds].filter((id) => !newIds.has(id)).sort(),
        )
        assert.equal(
          result.newlyShared.length + result.changedShared.length + result.noLongerShared.length <= oldIds.size + newIds.size,
          true,
        )
        count++
      }
    }
  }
  assert.equal(count, 96)
})
