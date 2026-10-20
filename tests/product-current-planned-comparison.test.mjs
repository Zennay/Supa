import assert from 'node:assert/strict'
import test from 'node:test'

import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { compareCurrentPlannedBaskets } from '../src/domain/currentPlannedComparison.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

const baselineStore = { ...m2Store, id: 'controlled-baseline', name: 'Controlled baseline' }
const candidateStore = { ...m2Store, id: 'controlled-candidate', name: 'Controlled candidate' }

function products(store, priceShift = 0) {
  return [
    ...m2Products.map((product) => ({
      ...product,
      id: `${store.id}-${product.id}`,
      storeId: store.id,
      priceCents: product.priceCents + priceShift,
    })),
    {
      id: `${store.id}-garam-50`,
      storeId: store.id,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + priceShift,
    },
  ]
}

function input(priceShift = -10) {
  return {
    plan: structuredClone(m2InitialPlan),
    recipes: structuredClone(m2Recipes),
    activeDays: [...m2DefaultActiveDays],
    baseline: { store: { ...baselineStore }, products: products(baselineStore) },
    candidate: { store: { ...candidateStore }, products: products(candidateStore, priceShift) },
  }
}

test('one current planner snapshot produces two matched, canonical, cent-exact baskets', () => {
  for (const priceShift of [-10, 0, 25]) {
    const currentInput = input(priceShift)
    const before = structuredClone(currentInput)
    const result = compareCurrentPlannedBaskets(currentInput)

    assert.ok(result)
    assert.equal(result.baseline.selectedMealCount, currentInput.activeDays.length)
    assert.equal(result.candidate.selectedMealCount, currentInput.activeDays.length)
    assert.equal(result.baseline.unresolvedLineCount, 0)
    assert.equal(result.candidate.unresolvedLineCount, 0)
    assert.equal(result.comparison?.claimable, true)
    assert.deepEqual(
      result.comparison,
      compareFullBaskets({ baseline: result.baseline, candidate: result.candidate }),
    )
    assert.equal(result.comparison?.outcome, priceShift < 0 ? 'better' : priceShift > 0 ? 'worse' : 'same')
    assert.equal(result.comparison?.deltaCents, result.candidate.totalCents - result.baseline.totalCents)
    assert.deepEqual(currentInput, before, 'never mutate the latest planner or store catalog')
  }
})

test('a price change re-computes a previously cheaper store as more expensive', () => {
  const currentInput = input(-10)
  const old = compareCurrentPlannedBaskets(currentInput)
  assert.equal(old?.comparison?.outcome, 'better')

  currentInput.candidate.products = products(candidateStore, 25)
  const next = compareCurrentPlannedBaskets(currentInput)
  assert.equal(next?.comparison?.outcome, 'worse')
  assert.notEqual(next?.comparison?.deltaCents, old?.comparison?.deltaCents)
  assert.equal(old?.comparison?.outcome, 'better', 'previous result does not change')
})

test('a recipe edit rebuilds both baskets rather than recycling prior demand', () => {
  const currentInput = input()
  const old = compareCurrentPlannedBaskets(currentInput)
  assert.equal(old?.comparison?.claimable, true)

  currentInput.plan = currentInput.plan.map((meal) =>
    meal.day === 'Ma' ? { ...meal, recipeId: 'pasta' } : meal,
  )
  const current = compareCurrentPlannedBaskets(currentInput)
  assert.ok(current)
  assert.equal(current.comparison?.claimable, true)
  assert.notDeepEqual(current.baseline.lines, old.baseline.lines)
  assert.deepEqual(
    current.baseline.lines.map((line) => [line.id, line.requirement]),
    current.candidate.lines.map((line) => [line.id, line.requirement]),
  )
  assert.equal(old.baseline.selectedMealCount, 4)
  assert.equal(current.baseline.selectedMealCount, 4)
})

test('changing active days rebuilds matched demand; empty week is usable without a claim', () => {
  const currentInput = input()
  const prior = compareCurrentPlannedBaskets(currentInput)
  assert.equal(prior?.comparison?.claimable, true)

  currentInput.activeDays = ['Ma', 'Wo']
  const reduced = compareCurrentPlannedBaskets(currentInput)
  assert.ok(reduced)
  assert.equal(reduced.baseline.selectedMealCount, 2)
  assert.equal(reduced.candidate.selectedMealCount, 2)
  assert.equal(reduced.comparison?.claimable, true)
  assert.ok(reduced.baseline.lines.length < prior.baseline.lines.length)

  currentInput.activeDays = []
  const empty = compareCurrentPlannedBaskets(currentInput)
  assert.ok(empty)
  assert.equal(empty.comparison, null)
  assert.deepEqual(empty.baseline.lines, [])
  assert.deepEqual(empty.candidate.lines, [])
  assert.equal(empty.baseline.totalCents, 0)
  assert.equal(empty.candidate.totalCents, 0)
})

test('missing catalog match preserves the incomplete basket but does not claim savings', () => {
  const currentInput = input()
  currentInput.candidate.products = currentInput.candidate.products.filter(
    (product) => !product.id.endsWith('garam-50'),
  )
  const result = compareCurrentPlannedBaskets(currentInput)
  assert.ok(result)
  assert.equal(result.baseline.unresolvedLineCount, 0)
  assert.equal(result.candidate.unresolvedLineCount, 1)
  assert.equal(result.comparison, null)
})

test('price and pack updates are recalculated using the real basket calculator', () => {
  const currentInput = input()
  const before = compareCurrentPlannedBaskets(currentInput)
  const item = currentInput.candidate.products.find((product) => product.id.endsWith('chicken-400'))
  assert.ok(item)
  item.packCount = 2

  const after = compareCurrentPlannedBaskets(currentInput)
  assert.ok(after)
  assert.notEqual(after.candidate.totalCents, before.candidate.totalCents)
  const currentChicken = after.candidate.lines.find((line) => line.id === 'chicken-thigh')
  assert.equal(currentChicken?.status, 'matched')
  assert.equal(currentChicken?.pack.count, 2)
  assert.equal(currentChicken?.packs, 1)
  assert.equal(after.comparison?.claimable, true)
  assert.equal(after.comparison?.deltaCents, after.candidate.totalCents - after.baseline.totalCents)
})

test('invalid monetary catalog data remains unresolved rather than a cheap claim', () => {
  const currentInput = input()
  const garam = currentInput.candidate.products.find((product) => product.id.endsWith('garam-50'))
  assert.ok(garam)
  garam.priceCents = NaN

  const result = compareCurrentPlannedBaskets(currentInput)
  assert.ok(result)
  assert.equal(result.comparison, null)
  assert.equal(result.candidate.unresolvedLineCount, 1)
})

test('identical stores do not produce an artificial comparison', () => {
  const currentInput = input()
  currentInput.candidate.store.id = currentInput.baseline.store.id
  const result = compareCurrentPlannedBaskets(currentInput)
  assert.ok(result)
  assert.equal(result.comparison, null)
})

test('invalid current plans and containers fail closed before any money comparison', () => {
  const mutations = [
    (value) => { value.activeDays = ['Ma', 'Ma'] },
    (value) => { value.activeDays = ['Ma', '  '] },
    (value) => { value.activeDays = null },
    (value) => { value.plan = null },
    (value) => { value.recipes = {} },
    (value) => { value.baseline = null },
    (value) => { value.candidate.products = null },
    (value) => { value.plan = value.plan.filter((meal) => meal.day !== 'Ma') },
    (value) => { value.plan = [...value.plan, { day: 'Ma', recipeId: 'pasta' }] },
    (value) => { value.plan[0] = { day: 'Ma', recipeId: 'missing-recipe' } },
    (value) => { value.baseline.store.id = '' },
    (value) => { value.candidate.store.name = ' ' },
  ]

  assert.equal(compareCurrentPlannedBaskets(null), null)
  for (const change of mutations) {
    const currentInput = input()
    change(currentInput)
    const before = structuredClone(currentInput)
    assert.doesNotThrow(() => compareCurrentPlannedBaskets(currentInput))
    assert.equal(compareCurrentPlannedBaskets(currentInput), null)
    assert.deepEqual(currentInput, before, 'invalid inputs must not be edited')
  }
})

test('reordering unordered catalogs and active days preserves the financial result', () => {
  const currentInput = input()
  const prior = compareCurrentPlannedBaskets(currentInput)
  assert.ok(prior)

  currentInput.activeDays.reverse()
  currentInput.plan.reverse()
  currentInput.candidate.products.reverse()
  currentInput.baseline.products.reverse()
  currentInput.recipes.reverse()

  const reordered = compareCurrentPlannedBaskets(currentInput)
  assert.ok(reordered)
  assert.deepEqual(reordered.comparison, prior.comparison)
  assert.deepEqual(reordered.baseline, prior.baseline)
  assert.deepEqual(reordered.candidate, prior.candidate)
})
