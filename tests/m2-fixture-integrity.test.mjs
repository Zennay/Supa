import assert from 'node:assert/strict'
import test from 'node:test'

import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

const canonical = (value) =>
  typeof value === 'string' && value.length > 0 && value === value.trim()

test('M2 fixture keeps canonical unique identities and valid plan references', () => {
  assert.ok(canonical(m2Store.id))
  assert.ok(canonical(m2Store.name))

  const recipeIds = new Set()
  for (const recipe of m2Recipes) {
    assert.ok(canonical(recipe.id))
    assert.ok(canonical(recipe.title))
    assert.equal(recipeIds.has(recipe.id), false, `duplicate recipe id: ${recipe.id}`)
    recipeIds.add(recipe.id)

    assert.equal(Number.isSafeInteger(recipe.minutes), true)
    assert.ok(recipe.minutes > 0)
    assert.equal(Number.isSafeInteger(recipe.servings), true)
    assert.ok(recipe.servings > 0)
    assert.equal(Number.isFinite(recipe.estimatedCost), true)
    assert.ok(recipe.estimatedCost >= 0)

    const tags = new Set()
    for (const tag of recipe.tags) {
      assert.ok(canonical(tag))
      assert.equal(tags.has(tag), false, `duplicate tag in ${recipe.id}: ${tag}`)
      tags.add(tag)
    }

    const ingredientIds = new Set()
    for (const ingredient of recipe.ingredients) {
      assert.ok(canonical(ingredient.id))
      assert.ok(canonical(ingredient.label))
      assert.ok(canonical(ingredient.query))
      assert.equal(
        ingredientIds.has(ingredient.id),
        false,
        `duplicate ingredient id in ${recipe.id}: ${ingredient.id}`,
      )
      ingredientIds.add(ingredient.id)
      assert.equal(Number.isFinite(ingredient.amount), true)
      assert.ok(ingredient.amount > 0)
      assert.ok(['g', 'kg', 'ml', 'l', 'piece'].includes(ingredient.unit))
    }
  }

  const plannedDays = new Set()
  for (const meal of m2InitialPlan) {
    assert.ok(canonical(meal.day))
    assert.ok(canonical(meal.recipeId))
    assert.equal(plannedDays.has(meal.day), false, `duplicate planned day: ${meal.day}`)
    plannedDays.add(meal.day)
    assert.equal(recipeIds.has(meal.recipeId), true, `missing recipe: ${meal.recipeId}`)
  }

  assert.deepEqual(m2DefaultActiveDays, m2InitialPlan.map((meal) => meal.day))
  assert.equal(new Set(m2DefaultActiveDays).size, m2DefaultActiveDays.length)
})

test('M2 fixture products remain safe deterministic basket inputs', () => {
  const productIds = new Set()

  for (const product of m2Products) {
    assert.ok(canonical(product.id))
    assert.ok(canonical(product.name))
    assert.equal(product.storeId, m2Store.id)
    assert.equal(productIds.has(product.id), false, `duplicate product id: ${product.id}`)
    productIds.add(product.id)

    assert.equal(typeof product.available, 'boolean')
    assert.equal(Number.isSafeInteger(product.priceCents), true)
    assert.ok(product.priceCents >= 0)

    assert.equal(Number.isFinite(product.packAmount), true)
    assert.ok(product.packAmount > 0)
    assert.ok(['g', 'kg', 'ml', 'l', 'piece'].includes(product.packUnit))

    if (product.packCount !== undefined && product.packCount !== null) {
      assert.equal(Number.isSafeInteger(product.packCount), true)
      assert.ok(product.packCount > 0)
    }
  }
})

test('M2 controlled plan only requires ingredient definitions that stay internally consistent', () => {
  const definitions = new Map()

  for (const recipe of m2Recipes) {
    for (const ingredient of recipe.ingredients) {
      const current = definitions.get(ingredient.id)
      const next = {
        label: ingredient.label,
        query: ingredient.query,
        unit: ingredient.unit,
      }

      if (current) {
        assert.deepEqual(
          next,
          current,
          `ingredient definition drift for ${ingredient.id}`,
        )
      } else {
        definitions.set(ingredient.id, next)
      }
    }
  }

  for (const meal of m2InitialPlan) {
    assert.ok(m2Recipes.some((recipe) => recipe.id === meal.recipeId))
  }
})
