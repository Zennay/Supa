import assert from 'node:assert/strict'
import test from 'node:test'

import { aggregatePlanIngredients, buildOneStoreBasket } from '../src/domain/basket.ts'

// Synthetic, frozen examples only. These do not represent observed retailer prices.
const store = Object.freeze({ id: 'pack-matrix-store', name: 'Voorbeeldwinkel' })
const otherStore = Object.freeze({ id: 'another-store', name: 'Andere winkel' })

function oneIngredientBasket({
  amount,
  unit,
  packAmount,
  packUnit,
  packCount = 1,
  priceCents = 137,
  products,
}) {
  const recipes = [{
    id: 'recipe',
    title: 'Voorbeeldrecept',
    minutes: 10,
    servings: 1,
    estimatedCost: 1.37,
    tags: [],
    ingredients: [{
      id: 'ingredient',
      label: 'Testingrediënt',
      query: 'testingredient',
      amount,
      unit,
    }],
  }]
  const candidate = {
    id: 'product',
    storeId: store.id,
    name: 'testingredient',
    available: true,
    packAmount,
    packUnit,
    packCount,
    priceCents,
  }

  return buildOneStoreBasket({
    store,
    recipes,
    plan: [{ day: 'Ma', recipeId: 'recipe' }],
    activeDays: ['Ma'],
    products: products ?? [candidate],
  })
}

test('pack conversion and boundary rounding remain exact across mass, volume and pieces', () => {
  const cases = [
    { name: '1500 g needs two 1 kg packs', amount: 1500, unit: 'g', packAmount: 1, packUnit: 'kg', packs: 2 },
    { name: '1.5 kg needs two 750 g packs', amount: 1.5, unit: 'kg', packAmount: 750, packUnit: 'g', packs: 2 },
    { name: '1750 ml needs three 0.75 l packs', amount: 1750, unit: 'ml', packAmount: 0.75, packUnit: 'l', packs: 3 },
    { name: '1.25 l needs three 500 ml packs', amount: 1.25, unit: 'l', packAmount: 500, packUnit: 'ml', packs: 3 },
    { name: '3 pieces need two 2-piece packs', amount: 3, unit: 'piece', packAmount: 2, packUnit: 'piece', packs: 2 },
    { name: 'exact cross-unit 1 l / 1000 ml is one pack', amount: 1, unit: 'l', packAmount: 1000, packUnit: 'ml', packs: 1 },
    { name: 'multipack count is included before rounding', amount: 901, unit: 'g', packAmount: 250, packUnit: 'g', packCount: 2, packs: 2 },
    { name: 'one 3-piece multipack covers two items', amount: 2, unit: 'piece', packAmount: 1, packUnit: 'piece', packCount: 3, packs: 1 },
  ]

  for (const scenario of cases) {
    const basket = oneIngredientBasket(scenario)
    assert.equal(basket.selectedMealCount, 1, scenario.name)
    assert.equal(basket.matchedLineCount, 1, scenario.name)
    assert.equal(basket.unresolvedLineCount, 0, scenario.name)
    assert.equal(basket.lines.length, 1, scenario.name)
    const line = basket.lines[0]
    assert.equal(line.status, 'matched', scenario.name)
    assert.equal(line.packs, scenario.packs, scenario.name)
    assert.equal(line.pricePerPackCents, 137, scenario.name)
    assert.equal(line.lineTotalCents, scenario.packs * 137, scenario.name)
    assert.equal(basket.totalCents, scenario.packs * 137, scenario.name)
  }
})

test('repeated ingredient demand is aggregated before buying whole packs', () => {
  const recipes = Object.freeze([Object.freeze({
    id: 'repeat',
    title: 'Rijst',
    minutes: 10,
    servings: 1,
    estimatedCost: 1,
    tags: Object.freeze([]),
    ingredients: Object.freeze([Object.freeze({
      id: 'rice',
      label: 'Rijst',
      query: 'rijst',
      amount: 400,
      unit: 'g',
    })]),
  })])
  const plan = Object.freeze([
    Object.freeze({ day: 'Ma', recipeId: 'repeat' }),
    Object.freeze({ day: 'Di', recipeId: 'repeat' }),
    Object.freeze({ day: 'Wo', recipeId: 'repeat' }),
    Object.freeze({ day: 'Do', recipeId: 'repeat' }),
  ])
  const products = Object.freeze([Object.freeze({
    id: 'rice-1kg',
    storeId: store.id,
    name: 'rijst',
    packAmount: 1,
    packUnit: 'kg',
    available: true,
    priceCents: 249,
  })])

  const expected = [
    { activeDays: [], amount: null, packs: 0, cents: 0 },
    { activeDays: ['Ma'], amount: 400, packs: 1, cents: 249 },
    { activeDays: ['Ma', 'Di'], amount: 800, packs: 1, cents: 249 },
    { activeDays: ['Ma', 'Di', 'Wo'], amount: 1200, packs: 2, cents: 498 },
    { activeDays: ['Ma', 'Di', 'Wo', 'Do'], amount: 1600, packs: 2, cents: 498 },
  ]

  for (const scenario of expected) {
    const aggregated = aggregatePlanIngredients(plan, recipes, scenario.activeDays)
    assert.equal(aggregated.length, scenario.amount === null ? 0 : 1)
    if (scenario.amount !== null) assert.equal(aggregated[0].amount, scenario.amount)

    const basket = buildOneStoreBasket({
      store, plan, recipes, activeDays: scenario.activeDays, products,
    })
    assert.equal(basket.selectedMealCount, scenario.activeDays.length)
    assert.equal(basket.totalCents, scenario.cents)
    assert.equal(basket.matchedLineCount, scenario.amount === null ? 0 : 1)
    assert.equal(basket.unresolvedLineCount, 0)
    if (scenario.amount !== null) assert.equal(basket.lines[0].packs, scenario.packs)
  }

  assert.equal(recipes[0].ingredients[0].amount, 400, 'read-only recipe input')
  assert.equal(products[0].priceCents, 249, 'read-only product input')
})

test('foreign-store offers cannot displace a valid local pack or contaminate its price', () => {
  const local = Object.freeze({
    id: 'local',
    storeId: store.id,
    name: 'testingredient',
    packAmount: 1,
    packUnit: 'kg',
    available: true,
    priceCents: 299,
  })
  const foreign = Object.freeze({
    ...local,
    id: 'foreign-cheap',
    storeId: otherStore.id,
    priceCents: 1,
  })

  for (const products of [[foreign, local], [local, foreign]]) {
    const basket = oneIngredientBasket({
      amount: 1200, unit: 'g', packAmount: 1, packUnit: 'kg',
      products,
    })
    assert.equal(basket.matchedLineCount, 1)
    assert.equal(basket.lines[0].productId, 'local')
    assert.equal(basket.lines[0].packs, 2)
    assert.equal(basket.totalCents, 598)
  }
})

test('missing compatible packs or invalid prices are unresolved, not zero-price baskets', () => {
  for (const scenario of [
    { amount: 1, unit: 'g', packAmount: 1, packUnit: 'ml' },
    { amount: 1, unit: 'g', packAmount: 1, packUnit: 'g', priceCents: -1 },
    { amount: 1, unit: 'g', packAmount: 1, packUnit: 'g', priceCents: Number.NaN },
  ]) {
    const basket = oneIngredientBasket(scenario)
    assert.equal(basket.matchedLineCount, 0)
    assert.equal(basket.unresolvedLineCount, 1)
    assert.equal(basket.lines[0].status, 'unresolved')
    assert.equal(basket.totalCents, 0, 'unknown amount must not become a quoted complete basket')
  }
})


test('pack rounding stays on the correct side of 160 integer-boundary cases', () => {
  const scenarios = [
    { name: 'grams into half-kilo', unit: 'g', packUnit: 'kg', packAmount: 0.5, divisor: 500, required: (step) => step * 37 },
    { name: 'millilitres into half-litre', unit: 'ml', packUnit: 'l', packAmount: 0.5, divisor: 500, required: (step) => step * 29 },
    { name: 'quarter-kilos into half-kilo', unit: 'kg', packUnit: 'kg', packAmount: 0.5, divisor: 2, required: (step) => step / 4, expected: (step) => Math.ceil(step / 2) },
    { name: 'pieces into five-count packs', unit: 'piece', packUnit: 'piece', packAmount: 5, divisor: 5, required: (step) => step },
  ]

  let inspected = 0
  for (const scenario of scenarios) {
    for (let step = 1; step <= 40; step += 1) {
      const amount = scenario.required(step)
      const packs = scenario.expected
        ? scenario.expected(step)
        : Math.ceil(amount / scenario.divisor)
      const basket = oneIngredientBasket({
        amount, unit: scenario.unit,
        packAmount: scenario.packAmount, packUnit: scenario.packUnit,
        priceCents: 101,
      })
      const label = `${scenario.name} at input ${step}`
      assert.equal(basket.unresolvedLineCount, 0, label)
      assert.equal(basket.matchedLineCount, 1, label)
      assert.equal(basket.lines[0].status, 'matched', label)
      assert.equal(basket.lines[0].packs, packs, label)
      assert.equal(basket.lines[0].lineTotalCents, packs * 101, label)
      assert.equal(basket.totalCents, packs * 101, label)
      inspected += 1
    }
  }

  assert.equal(inspected, 160)
})
