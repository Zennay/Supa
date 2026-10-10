import test from 'node:test'
import assert from 'node:assert/strict'
import { previewPlanRecipeSwap } from '../src/domain/planRecipeSwapPreview.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

test('all 192 day/recipe/active-week combinations preserve exact, honest snapshot invariants', () => {
  const originalPlan = JSON.stringify(m2InitialPlan)
  const originalProducts = JSON.stringify(m2Products)
  const days = m2InitialPlan.map((meal) => meal.day)
  let total = 0
  let ready = 0
  let unknown = 0

  for (const day of days) {
    for (const recipe of m2Recipes) {
      for (let mask = 0; mask < (1 << days.length); mask++) {
        const activeDays = days.filter((_, index) => (mask & (1 << index)) !== 0)
        const result = previewPlanRecipeSwap({
          day,
          replacementRecipeId: recipe.id,
          activeDays,
          plan: m2InitialPlan,
          recipes: m2Recipes,
          products: m2Products,
          store: m2Store,
        })
        total += 1
        assert.notEqual(result.status, 'invalid', `${day} ${recipe.id} ${mask}`)
        assert.equal(result.priceEvidence, 'input-snapshot-only')
        assert.deepEqual(result.changes.map((change) => change.ingredientId),
          [...result.changes.map((change) => change.ingredientId)].sort())
        assert.ok(result.changes.every((change) => change.before !== null || change.after !== null))
        assert.deepEqual(result.nextPlan.filter((meal) => meal.day !== day),
          m2InitialPlan.filter((meal) => meal.day !== day))
        assert.equal(result.nextPlan.find((meal) => meal.day === day).recipeId, recipe.id)
        assert.equal(result.before.store.id, m2Store.id)
        assert.equal(result.after.store.id, m2Store.id)
        if (result.status === 'ready') {
          ready += 1
          assert.equal(result.reason, null)
          assert.ok(activeDays.length > 0)
          assert.equal(result.before.unresolvedLineCount, 0)
          assert.equal(result.after.unresolvedLineCount, 0)
          assert.equal(result.deltaCents, result.after.totalCents - result.before.totalCents)
          assert.ok(Number.isSafeInteger(result.deltaCents))
        } else {
          unknown += 1
          assert.equal(result.deltaCents, null)
          assert.ok(result.reason)
        }
        if (mask === 0) {
          assert.equal(result.status, 'unknown')
          assert.deepEqual(result.changes, [])
        }
      }
    }
  }
  assert.equal(total, 192)
  assert.ok(ready > 0)
  assert.ok(unknown > 0)
  assert.equal(JSON.stringify(m2InitialPlan), originalPlan)
  assert.equal(JSON.stringify(m2Products), originalProducts)
})

test('a matched line reaching unsafe integer-cent multiplication stays unclaimable', () => {
  const massive = m2Products.map((product) => ({
    ...product,
    priceCents: product.id === 'spaghetti-500' ? Number.MAX_SAFE_INTEGER : product.priceCents,
  }))
  const preview = previewPlanRecipeSwap({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    products: massive,
    activeDays: ['Di', 'Wo'],
    day: 'Di',
    replacementRecipeId: 'pasta',
  })
  assert.equal(preview.status, 'unknown')
  assert.equal(preview.deltaCents, null)
})

test('no variation in input ordering changes the price delta or ingredient diff', () => {
  const input = {
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    products: m2Products,
    activeDays: ['Di'],
    day: 'Di',
    replacementRecipeId: 'pasta',
  }
  const normal = previewPlanRecipeSwap(input)
  const reversed = previewPlanRecipeSwap({
    ...input,
    plan: [...m2InitialPlan].reverse(),
    products: [...m2Products].reverse(),
    recipes: [...m2Recipes].reverse(),
    activeDays: ['Di'],
  })
  assert.equal(normal.status, 'ready')
  assert.equal(reversed.status, 'ready')
  assert.equal(normal.deltaCents, reversed.deltaCents)
  assert.deepEqual(normal.changes, reversed.changes)
})
