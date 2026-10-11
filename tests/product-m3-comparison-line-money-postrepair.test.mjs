import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Recipes,
} from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts,
  m3BaselineStore,
  m3CandidateProducts,
  m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'
import {
  basketComparisonCanShowMoney,
  basketComparisonHeadline,
} from '../src/features/basket/basketPresentation.ts'

function fixtureBasket(store, products) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    activeDays: m2DefaultActiveDays,
    recipes: m2Recipes,
    products,
  })
}

function completeFixtureComparison() {
  const baseline = fixtureBasket(m3BaselineStore, m3BaselineProducts)
  const candidate = fixtureBasket(m3CandidateStore, m3CandidateProducts)
  assert.equal(baseline.unresolvedLineCount, 0)
  assert.equal(candidate.unresolvedLineCount, 0)

  const comparison = compareFullBaskets({ baseline, candidate })
  assert.equal(comparison.claimable, true)
  return { comparison, candidate }
}

test('M3 actual basket-to-comparison-to-headline chain reconciles every financial line', () => {
  const { comparison, candidate } = completeFixtureComparison()
  assert.ok(comparison.lineDeltas.length > 1)
  assert.equal(
    comparison.lineDeltas.reduce((sum, line) => sum + line.baselineLineTotalCents, 0),
    comparison.baselineTotalCents,
  )
  assert.equal(
    comparison.lineDeltas.reduce((sum, line) => sum + line.candidateLineTotalCents, 0),
    comparison.candidateTotalCents,
  )
  assert.equal(basketComparisonCanShowMoney(comparison, candidate), true)
  assert.notEqual(basketComparisonHeadline(comparison, candidate), 'Nog geen betrouwbare vergelijking')
})

test('M3 independent postrepair consumer refuses per-line changes on otherwise valid fixture totals', async (t) => {
  const { comparison, candidate } = completeFixtureComparison()
  const negativeMutations = [
    ['price amount differs', (c) => { c.lineDeltas[0].candidateLineTotalCents += 1 }],
    ['baseline amount differs', (c) => { c.lineDeltas[0].baselineLineTotalCents += 1 }],
    ['line delta differs', (c) => { c.lineDeltas[0].deltaCents += 1 }],
    ['missing line', (c) => { c.lineDeltas.pop() }],
    ['duplicate identity', (c) => { c.lineDeltas[1].id = c.lineDeltas[0].id }],
    ['unsafe money', (c) => { c.lineDeltas[0].baselineLineTotalCents = Number.MAX_SAFE_INTEGER + 1 }],
    ['padded row identity', (c) => { c.lineDeltas[0].id += ' ' }],
    ['missing presentation label', (c) => { c.lineDeltas[0].ingredientLabel = '' }],
  ]

  for (const [label, mutate] of negativeMutations) {
    await t.test(label, () => {
      const corrupt = structuredClone(comparison)
      mutate(corrupt)
      assert.equal(basketComparisonCanShowMoney(corrupt, candidate), false)
      assert.equal(
        basketComparisonHeadline(corrupt, candidate),
        'Nog geen betrouwbare vergelijking',
      )
    })
  }
})

test('M3 reconciled comparison is order-independent but never edits the original', () => {
  const { comparison, candidate } = completeFixtureComparison()
  const reordered = structuredClone(comparison)
  reordered.lineDeltas.reverse()
  assert.equal(basketComparisonCanShowMoney(reordered, candidate), true)
  assert.deepEqual(
    comparison.lineDeltas.map((line) => line.id),
    [...reordered.lineDeltas.map((line) => line.id)].reverse(),
  )
})
