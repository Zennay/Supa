import assert from 'node:assert/strict'
import test from 'node:test'

import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { compareCurrentPlannedBaskets } from '../src/domain/currentPlannedComparison.ts'
import {
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

const days = m2InitialPlan.map((meal) => meal.day)
const recipeIds = m2Recipes.map((recipe) => recipe.id)
const baselineStore = { ...m2Store, id: 'qa-baseline', name: 'QA baseline test shop' }
const candidateStore = { ...m2Store, id: 'qa-candidate', name: 'QA candidate test shop' }

function catalog(store, priceShift = 0) {
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

function current(plan, activeDays, priceShift) {
  return {
    plan: structuredClone(plan),
    activeDays: [...activeDays],
    recipes: structuredClone(m2Recipes),
    baseline: { store: { ...baselineStore }, products: catalog(baselineStore) },
    candidate: { store: { ...candidateStore }, products: catalog(candidateStore, priceShift) },
  }
}

function scenarios() {
  const result = []
  for (let mask = 0; mask < (1 << days.length); mask++) {
    const activeDays = days.filter((_, index) => (mask & (1 << index)) !== 0)
    result.push({ activeDays, plan: m2InitialPlan, reason: 'original' })
    for (const day of activeDays) {
      const plan = m2InitialPlan.map((meal) =>
        meal.day === day
          ? { ...meal, recipeId: recipeIds.find((id) => id !== meal.recipeId) }
          : meal,
      )
      result.push({ activeDays, plan, reason: `swap ${day}` })
    }
  }
  return result
}

test('current plan builds two independent, cent-exact baskets over all week subsets and recipe swaps', () => {
  let count = 0
  let claimable = 0
  let empty = 0

  for (const { activeDays, plan, reason } of scenarios()) {
    for (const shift of [-10, 0, 25]) {
      const input = current(plan, activeDays, shift)
      const snapshot = structuredClone(input)
      const result = compareCurrentPlannedBaskets(input)
      const label = `${activeDays.join(',')} / ${reason} / shift ${shift}`
      assert.ok(result, label)
      assert.deepEqual(input, snapshot, `input mutated: ${label}`)
      assert.equal(result.baseline.selectedMealCount, activeDays.length, label)
      assert.equal(result.candidate.selectedMealCount, activeDays.length, label)
      assert.deepEqual(
        result.baseline.lines.map((line) => [line.id, line.requirement]),
        result.candidate.lines.map((line) => [line.id, line.requirement]),
        label,
      )
      assert.equal(result.baseline.unresolvedLineCount, 0, label)
      assert.equal(result.candidate.unresolvedLineCount, 0, label)

      if (activeDays.length === 0) {
        empty++
        assert.equal(result.comparison, null, label)
        assert.equal(result.baseline.totalCents, 0)
        assert.equal(result.candidate.totalCents, 0)
      } else {
        claimable++
        assert.deepEqual(
          result.comparison,
          compareFullBaskets({ baseline: result.baseline, candidate: result.candidate }),
          label,
        )
        assert.equal(result.comparison?.claimable, true, label)
        assert.equal(result.comparison?.outcome, shift < 0 ? 'better' : shift > 0 ? 'worse' : 'same', label)
        assert.equal(
          result.comparison?.deltaCents,
          result.candidate.totalCents - result.baseline.totalCents,
          label,
        )
        assert.ok(result.comparison.lineDeltas.length > 0, label)
      }
      count++
    }
  }

  assert.equal(count, scenarios().length * 3)
  assert.equal(empty, 3)
  assert.ok(claimable > 100, 'all non-empty subset and recipe-swap scenarios must be exercised')
})

test('rebuilding after changes never resurrects the previous claim or mutates the old result', () => {
  const input = current(m2InitialPlan, days, -10)
  const original = compareCurrentPlannedBaskets(input)
  assert.equal(original?.comparison?.outcome, 'better')
  const originalSnapshot = structuredClone(original)

  input.activeDays = ['Ma', 'Di']
  input.plan = input.plan.map((meal) =>
    meal.day === 'Ma' ? { ...meal, recipeId: 'pasta' } : meal,
  )
  input.candidate.products = catalog(candidateStore, 25)
  const refreshed = compareCurrentPlannedBaskets(input)
  assert.ok(refreshed)
  assert.equal(refreshed.comparison?.outcome, 'worse')
  assert.equal(refreshed.baseline.selectedMealCount, 2)
  assert.notDeepEqual(refreshed.baseline.lines, original.baseline.lines)
  assert.notEqual(refreshed.comparison?.deltaCents, original.comparison.deltaCents)
  assert.deepEqual(original, originalSnapshot, 'old object must not be rewritten into the new state')

  input.activeDays = []
  const empty = compareCurrentPlannedBaskets(input)
  assert.ok(empty)
  assert.equal(empty.comparison, null)
  assert.deepEqual(empty.baseline.lines, [])
  assert.deepEqual(empty.candidate.lines, [])
})

test('missing candidate item remains a visible incomplete basket but cannot claim a difference', () => {
  for (const shift of [-10, 0, 25]) {
    const input = current(m2InitialPlan, days, shift)
    input.candidate.products = input.candidate.products.filter((product) =>
      !product.id.endsWith('garam-50'),
    )
    const result = compareCurrentPlannedBaskets(input)
    assert.ok(result)
    assert.equal(result.baseline.unresolvedLineCount, 0)
    assert.equal(result.candidate.unresolvedLineCount, 1)
    assert.equal(result.comparison, null)

    // A later complete catalog must be rebuilt rather than reusing unknown.
    input.candidate.products = catalog(candidateStore, shift)
    const complete = compareCurrentPlannedBaskets(input)
    assert.equal(complete?.comparison?.claimable, true)
  }
})
