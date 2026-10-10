import test from 'node:test'
import assert from 'node:assert/strict'
import { acceptPlanRecipeSwap, previewPlanRecipeSwap } from '../src/domain/planRecipeSwapPreview.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

const context = {
  store: m2Store,
  plan: m2InitialPlan,
  recipes: m2Recipes,
  activeDays: ['Ma', 'Di'],
  products: m2Products,
  day: 'Di',
  replacementRecipeId: 'pasta',
}

test('explicit confirmation applies one recipe change without mutating caller or preview snapshots', () => {
  const preview = previewPlanRecipeSwap(context)
  assert.equal(preview.status, 'ready')
  const originalPreview = JSON.stringify(preview)
  const originalPlan = JSON.stringify(m2InitialPlan)
  const result = acceptPlanRecipeSwap(preview, m2InitialPlan, context.activeDays)
  assert.equal(result.status, 'applied')
  assert.equal(result.plan.find((meal) => meal.day === 'Di').recipeId, 'pasta')
  assert.equal(result.plan.find((meal) => meal.day === 'Ma').recipeId, 'tikka')
  assert.notEqual(result.plan, preview.nextPlan)
  assert.notEqual(result.plan[1], preview.nextPlan[1])
  assert.equal(JSON.stringify(m2InitialPlan), originalPlan)
  assert.equal(JSON.stringify(preview), originalPreview)
})

test('user may still choose a recipe if preview honestly reports unknown prices', () => {
  const preview = previewPlanRecipeSwap({
    ...context,
    products: m2Products.filter((product) => product.id !== 'spaghetti-500'),
  })
  assert.equal(preview.status, 'unknown')
  assert.equal(preview.deltaCents, null)
  const result = acceptPlanRecipeSwap(preview, m2InitialPlan, context.activeDays)
  assert.equal(result.status, 'applied')
  assert.equal(result.plan[1].recipeId, 'pasta')
})

test('stale recipe/active-day/reset/order changes block a previously approved snapshot', () => {
  const preview = previewPlanRecipeSwap(context)
  assert.equal(preview.status, 'ready')
  const shifted = m2InitialPlan.map((meal) =>
    meal.day === 'Wo' ? { ...meal, recipeId: 'tikka' } : meal,
  )
  const cases = [
    [shifted, context.activeDays],
    [m2InitialPlan, ['Ma']],
    [m2InitialPlan, ['Ma', 'Di', 'Wo']],
    [[...m2InitialPlan].reverse(), context.activeDays],
    [m2InitialPlan.slice(0, 3), context.activeDays],
    [null, context.activeDays],
    [m2InitialPlan, null],
    [m2InitialPlan, ['Ma', 'Ma']],
  ]
  for (const [plan, activeDays] of cases) {
    const result = acceptPlanRecipeSwap(preview, plan, activeDays)
    assert.equal(result.status, 'stale')
    assert.equal(result.plan, null)
  }
})

test('changing a live day ordering only is not a stale active-day selection', () => {
  const preview = previewPlanRecipeSwap(context)
  const result = acceptPlanRecipeSwap(preview, m2InitialPlan, ['Di', 'Ma'])
  assert.equal(result.status, 'applied')
  assert.equal(result.plan[1].recipeId, 'pasta')
})

test('a malformed or tampered preview cannot produce a committed plan', () => {
  const preview = previewPlanRecipeSwap(context)
  assert.equal(preview.status, 'ready')
  const invalid = previewPlanRecipeSwap({ ...context, day: 'non-existent' })
  assert.equal(acceptPlanRecipeSwap(invalid, m2InitialPlan, context.activeDays).status, 'invalid')
  const cases = [
    { nextPlan: preview.nextPlan.slice(1) },
    { changedDay: 'Wo' },
    { replacementRecipeId: 'unknown' },
    { nextPlan: preview.nextPlan.map((meal) =>
      meal.day === 'Ma' ? { ...meal, recipeId: 'teriyaki' } : meal) },
    { nextPlan: preview.nextPlan.map((meal) =>
      meal.day === 'Di' ? { ...meal, recipeId: 'tikka' } : meal) },
  ]
  for (const tamper of cases) {
    const result = acceptPlanRecipeSwap({ ...preview, ...tamper }, m2InitialPlan, context.activeDays)
    assert.equal(result.status, 'invalid', JSON.stringify(tamper))
    assert.equal(result.plan, null)
  }
})

test('inactive-day preview remains explicitly confirmable but does not alter selected meals', () => {
  const activeDays = ['Wo']
  const preview = previewPlanRecipeSwap({ ...context, activeDays })
  assert.equal(preview.status, 'ready')
  assert.equal(preview.deltaCents, 0)
  const applied = acceptPlanRecipeSwap(preview, m2InitialPlan, activeDays)
  assert.equal(applied.status, 'applied')
  assert.equal(applied.plan.find((meal) => meal.day === 'Di').recipeId, 'pasta')
  assert.deepEqual(activeDays, ['Wo'])
})
