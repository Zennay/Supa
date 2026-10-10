import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { buildExactDecimalOneStoreBasket } from '../src/domain/exactDecimalOneStoreBasket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

// Controlled synthetic grocery economics, NOT observed supermarket pricing.
const store = { id: 'exact-decimal-product-store', name: 'Voorbeeldwinkel' }

function synthetic(a, b, unit = 'g', packAmount = 0.3, packUnit = unit) {
  const recipes = [a, b].map((amount, index) => ({
    id: `recipe-${index}`, title: 'Recept', minutes: 10, servings: 1,
    estimatedCost: 1.99, tags: [],
    ingredients: [{
      id: 'ingredient', label: 'Testingrediënt',
      query: 'testingredient', amount, unit,
    }],
  }))
  return {
    store, recipes,
    plan: [
      { day: 'Ma', recipeId: 'recipe-0' },
      { day: 'Di', recipeId: 'recipe-1' },
    ],
    activeDays: ['Ma', 'Di'],
    products: [{
      id: 'micro-pack', storeId: store.id, name: 'testingredient',
      available: true, packAmount, packUnit, priceCents: 199,
    }],
  }
}

function exactLine(input) {
  const result = buildExactDecimalOneStoreBasket(input)
  assert.ok(result, 'original valid recipes and matching products should resolve')
  assert.equal(result.lines.length, 1)
  assert.equal(result.lines[0].status, 'matched')
  assert.equal(result.matchedLineCount, 1)
  assert.equal(result.unresolvedLineCount, 0)
  return { basket: result, line: result.lines[0] }
}

test('real functional fix: 0.1 + 0.2 g produces one pack costing 199c, not 398c', () => {
  const input = synthetic(0.1, 0.2)
  const original = structuredClone(input)
  const legacy = buildOneStoreBasket(input)
  assert.equal(legacy.totalCents, 398, 'reproduce current known floating overbuy')
  const { basket, line } = exactLine(input)
  assert.equal(line.requirement.amount, 0.3)
  assert.equal(line.packs, 1)
  assert.equal(line.lineTotalCents, 199)
  assert.equal(basket.totalCents, 199)
  assert.equal(basket.selectedMealCount, 2)
  assert.deepEqual(input, original, 'building exact decimal basket never mutates inputs')
})

test('cross-unit g/kg and ml/l split quantities preserve precise pack coverage', async (t) => {
  const scenarios = [
    ['millilitres', 0.1, 0.2, 'ml', 0.3, 'ml', 0.3],
    ['kilograms to grams', 0.0001, 0.0002, 'kg', 0.3, 'g', 0.0003],
    ['litres to millilitres', 0.0001, 0.0002, 'l', 0.3, 'ml', 0.0003],
  ]
  for (const [label, a, b, unit, packAmount, packUnit, expected] of scenarios) {
    await t.test(label, () => {
      const { basket, line } = exactLine(synthetic(a, b, unit, packAmount, packUnit))
      assert.equal(line.requirement.amount, expected)
      assert.equal(line.packs, 1)
      assert.equal(basket.totalCents, 199)
    })
  }
})

test('genuine fractional overshoot remains a second 199-cent pack', async (t) => {
  for (const [a, b, packAmount, expected] of [
    [0.1, 0.2001, 0.3, 2],
    [0.15, 0.15, 0.2999, 2],
    [0.15, 0.15, 0.3, 1],
  ]) {
    await t.test(`${a}+${b} into ${packAmount}`, () => {
      const { basket, line } = exactLine(synthetic(a, b, 'g', packAmount))
      assert.equal(line.packs, expected)
      assert.equal(basket.totalCents, expected * 199)
    })
  }
})

test('canonical Tuesday M2 basket retains exact price and line identities', () => {
  const input = {
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: ['Di'], products: m2Products,
  }
  const original = buildOneStoreBasket(input)
  const exact = buildExactDecimalOneStoreBasket(input)
  assert.deepEqual(exact, original)
})

test('incomplete product catalog remains unresolved and never fabricates price', () => {
  const input = synthetic(0.1, 0.2)
  input.products = []
  const result = buildExactDecimalOneStoreBasket(input)
  assert.ok(result)
  assert.equal(result.lines.length, 1)
  assert.equal(result.unresolvedLineCount, 1)
  assert.equal(result.matchedLineCount, 0)
  assert.equal(result.totalCents, 0)
  assert.equal(result.lines[0].status, 'unresolved')
  assert.equal(result.lines[0].requirement.amount, 0.3)
})

test('invalid active day or unknown recipes fail closed instead of quoting a basket', () => {
  const valid = synthetic(0.1, 0.2)
  for (const input of [
    { ...valid, activeDays: ['Ma', 'Ma'] },
    { ...valid, plan: [{ day: 'Ma', recipeId: 'missing' }] },
    { ...valid, products: null },
    { ...valid, recipes: null },
    null,
  ]) {
    assert.equal(buildExactDecimalOneStoreBasket(input), null)
  }
})

test('safe cents and untrusted source quantities never become an apparent bargain', () => {
  const input = synthetic(0.1, 0.2)
  const tooLargePrice = {
    ...input,
    products: input.products.map((p) =>
      ({ ...p, priceCents: Number.MAX_SAFE_INTEGER })),
  }
  const excessive = buildExactDecimalOneStoreBasket(tooLargePrice)
  assert.ok(excessive === null || excessive.unresolvedLineCount > 0)
  assert.equal(excessive?.totalCents ?? 0, 0, 'unsafe price must never become a matched monetary claim')
  const malformed = synthetic(0.1, 0.2)
  malformed.recipes[1].ingredients[0].amount = Number.POSITIVE_INFINITY
  const basket = buildExactDecimalOneStoreBasket(malformed)
  assert.ok(basket === null || basket.unresolvedLineCount > 0)
})
