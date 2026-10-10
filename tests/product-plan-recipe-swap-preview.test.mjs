import test from 'node:test'
import assert from 'node:assert/strict'
import { previewPlanRecipeSwap } from '../src/domain/planRecipeSwapPreview.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

const base = {
  store: m2Store,
  plan: m2InitialPlan,
  recipes: m2Recipes,
  products: m2Products,
  day: 'Di',
  replacementRecipeId: 'pasta',
  activeDays: ['Di'],
}

test('preview reports actual same-store basket difference for a single active recipe swap', () => {
  const beforeInput = JSON.stringify(base)
  const result = previewPlanRecipeSwap(base)
  assert.equal(result.status, 'ready')
  assert.equal(result.priceEvidence, 'input-snapshot-only')
  assert.equal(result.reason, null)
  assert.equal(result.before.unresolvedLineCount, 0)
  assert.equal(result.after.unresolvedLineCount, 0)
  assert.equal(result.deltaCents, result.after.totalCents - result.before.totalCents)
  assert.equal(result.deltaCents, -559)
  assert.equal(result.before.store.id, result.after.store.id)
  assert.equal(result.nextPlan.find((meal) => meal.day === 'Di').recipeId, 'pasta')
  assert.equal(base.plan.find((meal) => meal.day === 'Di').recipeId, 'teriyaki')
  assert.equal(JSON.stringify(base), beforeInput)
  assert.deepEqual(result.changes.map((line) => line.ingredientId), [
    'basmati-rice', 'broccoli', 'edamame', 'greek-yogurt', 'spaghetti',
    'teriyaki-sauce', 'tomato-cubes',
  ])
  assert.ok(result.changes.some((line) => line.kind === 'added'))
  assert.ok(result.changes.some((line) => line.kind === 'removed'))
})

test('same recipe is a stable, immutable zero-impact preview', () => {
  const result = previewPlanRecipeSwap({ ...base, replacementRecipeId: 'teriyaki' })
  assert.equal(result.status, 'ready')
  assert.equal(result.deltaCents, 0)
  assert.deepEqual(result.changes, [])
  assert.notEqual(result.nextPlan, base.plan)
})

test('multi-day recipe reuse keeps shared product and counts changed pack requirements', () => {
  const plan = [{ day: 'Ma', recipeId: 'teriyaki' }, { day: 'Di', recipeId: 'teriyaki' }]
  const result = previewPlanRecipeSwap({ ...base, plan, activeDays: ['Ma', 'Di'] })
  assert.equal(result.status, 'ready')
  assert.ok(result.changes.length > 0)
  assert.equal(result.changes.find((line) => line.ingredientId === 'basmati-rice'), undefined)
  assert.equal(result.after.lines.find((line) => line.id === 'basmati-rice').packs, 1)
  assert.equal(result.deltaCents, result.after.totalCents - result.before.totalCents)
})

test('empty planner can be edited, but produces no artificial pricing claim', () => {
  const result = previewPlanRecipeSwap({ ...base, activeDays: [] })
  assert.equal(result.status, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.reason, 'no active meals to price')
  assert.deepEqual(result.changes, [])
  assert.equal(result.nextPlan.find((meal) => meal.day === 'Di').recipeId, 'pasta')
})

test('incomplete store data never yields a signed price delta', () => {
  const products = m2Products.filter((product) => product.id !== 'spaghetti-500')
  const result = previewPlanRecipeSwap({ ...base, products })
  assert.equal(result.status, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.ok(result.after.unresolvedLineCount > 0)
  assert.ok(result.changes.some((line) => line.after?.status === 'unresolved'))
})

test('foreign-store products cannot count as store price evidence', () => {
  const products = m2Products.map((product) => ({ ...product, storeId: 'other-store' }))
  const result = previewPlanRecipeSwap({ ...base, products })
  assert.equal(result.status, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.ok(result.before.unresolvedLineCount > 0)
})

test('malformed or ambiguous choices fail closed instead of altering the input', () => {
  const cases = [
    { day: 'Do not exist' },
    { day: ' Di' },
    { replacementRecipeId: 'nonexistent' },
    { replacementRecipeId: ' pasta ' },
    { activeDays: ['Di', 'Di'] },
    { activeDays: ['Yesterday'] },
    { plan: [...m2InitialPlan, { day: 'Di', recipeId: 'pasta' }] },
    { plan: m2InitialPlan.filter((entry) => entry.day !== 'Di') },
    { recipes: [...m2Recipes, m2Recipes[2]] },
    { store: { ...m2Store, id: ' ' } },
    { products: null },
  ]
  for (const change of cases) {
    const result = previewPlanRecipeSwap({ ...base, ...change })
    assert.equal(result.status, 'invalid', JSON.stringify(change))
    assert.equal(result.deltaCents, null)
    assert.deepEqual(result.changes, [])
  }
})

test('preview reports a per-line price-only change without miscalling it recipe savings', () => {
  const products = m2Products.map((product) =>
    product.id === 'spaghetti-500' ? { ...product, priceCents: 140 } : { ...product },
  )
  const before = previewPlanRecipeSwap(base)
  const after = previewPlanRecipeSwap({ ...base, products })
  assert.equal(before.status, 'ready')
  assert.equal(after.status, 'ready')
  assert.equal(after.deltaCents, before.deltaCents + 1)
  assert.equal(after.priceEvidence, 'input-snapshot-only')
  assert.deepEqual(after.changes.map((line) => line.ingredientId), before.changes.map((line) => line.ingredientId))
})
