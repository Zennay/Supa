import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregatePlanIngredients, buildOneStoreBasket } from '../src/domain/basket.ts'
import { sumDecimalDemandUnits } from '../src/domain/decimalPackArithmetic.ts'
import { m2Products, m2Store } from '../src/data/m2Fixture.ts'

// Independent controlled recipe fixtures. No live supermarket observations.
function recipe(id, amount, unit, type = 'rice') {
  const ingredient = type === 'rice'
    ? { id: 'basmati-rice', label: 'Basmati rijst', query: 'basmati rijst' }
    : { id: 'teriyaki-sauce', label: 'Teriyaki saus', query: 'teriyaki saus' }
  return {
    id, title: id, minutes: 10, servings: 1, estimatedCost: 1, tags: [],
    ingredients: [{ ...ingredient, amount, unit }],
  }
}
function setup(entries, type = 'rice') {
  const recipes = entries.map(([amount, unit], i) => recipe('meal-' + i, amount, unit, type))
  const plan = recipes.map((r, i) => ({ day: 'day-' + i, recipeId: r.id }))
  return { plan, recipes, activeDays: plan.map(p => p.day) }
}

test('three meals with 0.15kg, 150g and 0.2kg share one 0.5kg rice demand and one pack', () => {
  const input = setup([[0.15, 'kg'], [150, 'g'], [0.2, 'kg']])
  const copy = structuredClone(input)
  const aggregated = aggregatePlanIngredients(input.plan, input.recipes, input.activeDays)
  assert.equal(aggregated.length, 1)
  assert.equal(aggregated[0].amount, 0.5)
  assert.equal(aggregated[0].unit, 'kg')
  const result = buildOneStoreBasket({
    ...input, store: m2Store,
    products: m2Products.filter(p => p.id === 'basmati-1kg'),
  })
  assert.equal(result.selectedMealCount, 3)
  assert.equal(result.matchedLineCount, 1)
  assert.equal(result.unresolvedLineCount, 0)
  assert.equal(result.lines[0].status, 'matched')
  assert.equal(result.lines[0].packs, 1)
  assert.equal(result.totalCents, 249)
  assert.deepEqual(input, copy)
})

test('0.15l + 150ml reaches exact 0.3l volume; shopping buys two 250ml packs', () => {
  const input = setup([[0.15, 'l'], [150, 'ml']], 'sauce')
  const aggregated = aggregatePlanIngredients(input.plan, input.recipes, input.activeDays)
  assert.equal(aggregated[0].amount, 0.3)
  assert.equal(aggregated[0].unit, 'l')
  const result = buildOneStoreBasket({
    ...input, store: m2Store,
    products: m2Products.filter(p => p.id === 'teriyaki-250'),
  })
  assert.equal(result.matchedLineCount, 1)
  assert.equal(result.lines[0].status, 'matched')
  assert.equal(result.lines[0].packs, 2)
  assert.equal(result.totalCents, 498)
})

test('tiny but representable g/kg quantities do not disappear during unit conversion', () => {
  assert.equal(sumDecimalDemandUnits(
    [{ amount: 1e-307, unit: 'g' }, { amount: 1e-310, unit: 'kg' }], 'g',
  ), 2e-307)
  assert.equal(sumDecimalDemandUnits(
    [{ amount: 1e-310, unit: 'kg' }, { amount: 1e-307, unit: 'g' }], 'kg',
  ), 2e-310)
})

test('unit mismatch, zero, nonfinite and invalid target cannot be summed as money', () => {
  assert.equal(sumDecimalDemandUnits([{ amount: 1, unit: 'g' }, { amount: 1, unit: 'ml' }], 'g'), null)
  assert.equal(sumDecimalDemandUnits([{ amount: 0, unit: 'g' }], 'g'), null)
  assert.equal(sumDecimalDemandUnits([{ amount: Infinity, unit: 'g' }], 'g'), null)
  assert.equal(sumDecimalDemandUnits([{ amount: 1, unit: 'g' }], 'not-a-unit'), null)
})

test('missing amount in mixed-unit recipe demand remains visibly unresolved, never priced', () => {
  const input = setup([[null, 'kg'], [100, 'g']])
  const result = buildOneStoreBasket({
    ...input, store: m2Store,
    products: m2Products.filter(p => p.id === 'basmati-1kg'),
  })
  assert.equal(result.lines.length, 1)
  assert.equal(result.lines[0].status, 'unresolved')
  assert.equal(result.matchedLineCount, 0)
  assert.equal(result.unresolvedLineCount, 1)
  assert.equal(result.totalCents, 0)
})

test('same-unit 0.1 plus 0.2 exact decimal behavior remains untouched', () => {
  const input = setup([[0.1, 'g'], [0.2, 'g']])
  assert.equal(aggregatePlanIngredients(input.plan, input.recipes, input.activeDays)[0].amount, 0.3)
})
