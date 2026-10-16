import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { curatedFigmaRecipes } from '../src/features/recipes/curatedFigmaRecipes.ts'
import { m2Recipes } from '../src/data/m2Fixture.ts'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2Store, m2Products } from '../src/data/m2Fixture.ts'

test('original Figma six photos have six unique fully cookable recipes', () => {
  const titles = ['Thai red curry', 'Quesadillas', 'Fried rice', 'Bao buns', 'Katsu curry', 'Groente pasta']
  assert.deepEqual(curatedFigmaRecipes.map(r => r.title), titles)
  assert.equal(new Set(curatedFigmaRecipes.map(r => r.id)).size, 6)
  assert.equal(new Set([...m2Recipes, ...curatedFigmaRecipes].map(r => r.id)).size, 9)
  for (const recipe of curatedFigmaRecipes) {
    assert.equal(recipe.source, 'supa-original-recipe')
    assert.equal(recipe.servings, 2)
    assert.ok(recipe.minutes >= 15 && recipe.minutes <= 40)
    assert.ok(recipe.ingredients.length >= 4)
    assert.ok(recipe.steps.length >= 4)
    assert.ok(recipe.steps.every(step => typeof step === 'string' && step.trim().length > 15))
    assert.ok(recipe.ingredients.every(i =>
      typeof i.id === 'string' && i.id.length > 2 &&
      typeof i.query === 'string' && i.query.length > 2 &&
      Number.isSafeInteger(i.amount) && i.amount > 0 &&
      ['g','kg','ml','l','piece'].includes(i.unit)))
    assert.ok(Number.isNaN(recipe.estimatedCost), 'not a fake retailer price')
  }
})

test('Figma recipe can enter real planner matching without contaminating product example prices', () => {
  const plan = [{ day: 'Ma', recipeId: 'supa-fried-rice' }]
  const basket = buildOneStoreBasket({
    store: m2Store, plan,
    recipes: [...m2Recipes, ...curatedFigmaRecipes],
    activeDays: ['Ma'], products: m2Products,
  })
  assert.equal(basket.selectedMealCount, 1)
  assert.ok(basket.lines.length > 0)
  assert.ok(basket.lines.some(line => line.ingredientLabel === 'Basmati rijst'))
  assert.ok(basket.lines.some(line => line.ingredientLabel === 'Eieren'))
  assert.ok(basket.unresolvedLineCount >= 1, 'unavailable demo-ingredient matches stay unresolved')
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.match(app, /\.\.\.curatedFigmaRecipes/)
  assert.doesNotMatch(app, /Figma.*estimatedCost.*priceCents/)
})
