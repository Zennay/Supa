import assert from 'node:assert/strict'
import test from 'node:test'

import { aggregatePlanIngredients, buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2Products, m2Store } from '../src/data/m2Fixture.ts'

function setup(first, second, { mutateSecond } = {}) {
  const common = { id: 'basmati-rice', label: 'Basmati rijst', query: 'basmati rijst' }
  const recipes = [first, second].map((ingredient, index) => ({
    id: 'controlled-recipe-' + index,
    title: 'Controlled rice ' + index,
    minutes: 15, servings: 1, estimatedCost: 2, tags: [],
    ingredients: [{ ...common, ...ingredient, ...(index === 1 ? mutateSecond : {}) }],
  }))
  const plan = [
    { day: 'Ma', recipeId: recipes[0].id },
    { day: 'Di', recipeId: recipes[1].id },
  ]
  return { recipes, plan, activeDays: ['Ma', 'Di'] }
}

test('M2 two recipes with 0.2 kg and 150 g of the same rice aggregate to 0.35 kg', () => {
  const input = setup(
    { amount: 0.2, unit: 'kg' },
    { amount: 150, unit: 'g' },
  )
  const before = structuredClone(input)
  const rows = aggregatePlanIngredients(input.plan, input.recipes, input.activeDays)
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].requirement, undefined)
  assert.equal(rows[0].amount, 0.35)
  assert.equal(rows[0].unit, 'kg')
  assert.deepEqual(input, before)
})

test('M2 reverse 150 g + 0.2 kg yields exact 350 g and one honest store basket', () => {
  const input = setup(
    { amount: 150, unit: 'g' },
    { amount: 0.2, unit: 'kg' },
  )
  const rows = aggregatePlanIngredients(input.plan, input.recipes, input.activeDays)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].amount, 350)
  assert.equal(rows[0].unit, 'g')
  const basket = buildOneStoreBasket({
    store: m2Store, ...input,
    products: m2Products.filter(product => product.id === 'basmati-1kg'),
  })
  assert.equal(basket.selectedMealCount, 2)
  assert.equal(basket.lines.length, 1)
  assert.equal(basket.matchedLineCount, 1)
  assert.equal(basket.unresolvedLineCount, 0)
  assert.equal(basket.lines[0].status, 'matched')
  assert.equal(basket.lines[0].packs, 1)
  assert.equal(basket.lines[0].lineTotalCents, 249)
  assert.equal(basket.totalCents, 249)
})

test('M2 0.07 ml + 0.00007 l is exactly 0.14 ml, never binary drift', () => {
  const input = setup(
    { amount: 0.07, unit: 'ml' },
    { amount: 0.00007, unit: 'l' },
  )
  const rows = aggregatePlanIngredients(input.plan, input.recipes, input.activeDays)
  assert.equal(rows[0].amount, 0.14)
  assert.equal(rows[0].unit, 'ml')
})

test('M2 genuine gram/millilitre family mismatch is still definition drift', () => {
  const input = setup(
    { amount: 0.2, unit: 'kg' },
    { amount: 150, unit: 'ml' },
  )
  assert.throws(
    () => aggregatePlanIngredients(input.plan, input.recipes, input.activeDays),
    /Ingredient definition drift/,
  )
})

test('M2 different ingredient name for the same ID remains definition drift', () => {
  const input = setup(
    { amount: 150, unit: 'g' },
    { amount: 0.2, unit: 'kg' },
    { mutateSecond: { query: 'onverwant product' } },
  )
  assert.throws(
    () => aggregatePlanIngredients(input.plan, input.recipes, input.activeDays),
    /Ingredient definition drift/,
  )
})

test('M2 same-unit decimal 0.1 + 0.2 still aggregates to exact 0.3', () => {
  const input = setup(
    { amount: 0.1, unit: 'g' },
    { amount: 0.2, unit: 'g' },
  )
  assert.equal(aggregatePlanIngredients(input.plan, input.recipes, input.activeDays)[0].amount, 0.3)
})
