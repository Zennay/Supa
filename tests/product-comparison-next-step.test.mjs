import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { comparisonNextStep } from '../src/features/basket/comparisonNextStep.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

const baselineStore = { id: 'comparison-guidance-baseline', name: 'Testwinkel A' }
const candidateStore = { id: 'comparison-guidance-candidate', name: 'Testwinkel B' }

function basket(store, { activeDays = m2DefaultActiveDays, priceDelta = 0, missing = false } = {}) {
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${store.id}-${product.id}`,
      storeId: store.id,
      priceCents: product.priceCents + priceDelta,
    })),
    {
      id: `${store.id}-garam`,
      storeId: store.id,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      priceCents: 139 + priceDelta,
      available: true,
    },
  ]
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays,
    products: missing ? products.filter((product) => !product.id.endsWith('-garam')) : products,
  })
}

function scenario(base, candidate) {
  return {
    baseline: base,
    candidate,
    comparison: compareFullBaskets({ baseline: base, candidate }),
  }
}

test('complete equal, lower and higher synthetic baskets permit only controlled comparison guidance', () => {
  for (const change of [-10, 0, 10]) {
    const value = scenario(
      basket(baselineStore),
      basket(candidateStore, { priceDelta: change }),
    )
    assert.equal(value.comparison.claimable, true)
    const guidance = comparisonNextStep(value)
    assert.equal(guidance.code, 'comparison-ready')
    assert.equal(guidance.canShowDifference, true)
    assert.match(guidance.explanation, /geen actuele winkelprijzen|geen actuele/i)
    assert.match(guidance.explanation, /geen.*besparingen/i)
  }
})

test('a completely empty planned week cannot be described as a financial comparison (issue #1051)', () => {
  const result = scenario(
    basket(baselineStore, { activeDays: [] }),
    basket(candidateStore, { activeDays: [] }),
  )
  assert.equal(result.comparison.claimable, true, 'records existing comparator regression for owner')
  assert.equal(result.comparison.outcome, 'same')
  assert.equal(comparisonNextStep(result).code, 'choose-meals')
  assert.equal(comparisonNextStep(result).canShowDifference, false)
})

test('one empty week also requires a plan before showing a comparison', () => {
  const result = scenario(
    basket(baselineStore, { activeDays: [] }),
    basket(candidateStore),
  )
  assert.equal(comparisonNextStep(result).code, 'choose-meals')
})

test('unresolved controlled ingredient gets a concrete review action, never a price claim', () => {
  const result = scenario(
    basket(baselineStore),
    basket(candidateStore, { missing: true }),
  )
  assert.equal(result.candidate.unresolvedLineCount, 1)
  assert.equal(result.comparison.claimable, false)
  const guidance = comparisonNextStep(result)
  assert.equal(guidance.code, 'complete-products')
  assert.equal(guidance.canShowDifference, false)
  assert.match(guidance.action, /ingrediënten/)
  assert.doesNotMatch(JSON.stringify(guidance), /garam|candidate basket|baseline basket/i)
})

test('different active days require the same planned demand', () => {
  const result = scenario(
    basket(baselineStore),
    basket(candidateStore, { activeDays: m2DefaultActiveDays.slice(0, 1) }),
  )
  assert.equal(result.comparison.claimable, false)
  assert.equal(comparisonNextStep(result).code, 'align-plans')
})

test('two baskets for one store request a different store', () => {
  const result = scenario(
    basket(baselineStore),
    basket(baselineStore, { priceDelta: 2 }),
  )
  assert.equal(result.comparison.claimable, false)
  assert.equal(comparisonNextStep(result).code, 'choose-different-stores')
})

test('contradictory money, misleading outcome and explicit unknown cannot unlock a price difference', () => {
  const value = scenario(basket(baselineStore), basket(candidateStore, { priceDelta: -10 }))
  assert.equal(value.comparison.claimable, true)
  const variants = [
    { ...value.comparison, outcome: 'unknown' },
    { ...value.comparison, savingsCents: 99 },
    { ...value.comparison, deltaCents: 0 },
    { ...value.comparison, candidateTotalCents: 1 },
    { ...value.comparison, reasons: ['unexpected diagnostics'] },
    { ...value.comparison, claimable: false },
    { ...value.comparison, lineDeltas: [], outcome: 'same' },
  ]
  for (const comparison of variants) {
    assert.equal(
      comparisonNextStep({ ...value, comparison }).canShowDifference,
      false,
      JSON.stringify(comparison),
    )
  }
})

test('invalid count, null container, and empty line lists fail closed without exceptions', () => {
  const value = scenario(basket(baselineStore), basket(candidateStore))
  for (const invalid of [
    { ...value, baseline: { ...value.baseline, selectedMealCount: NaN } },
    { ...value, candidate: { ...value.candidate, unresolvedLineCount: -1 } },
    { ...value, baseline: { ...value.baseline, lines: null } },
    { ...value, candidate: null },
    { ...value, comparison: null },
    null,
  ]) {
    assert.equal(comparisonNextStep(invalid).canShowDifference, false)
  }
})

test('new copy stays consumer-facing and returns a concrete next action in every state', () => {
  const cases = [
    scenario(basket(baselineStore, { activeDays: [] }), basket(candidateStore, { activeDays: [] })),
    scenario(basket(baselineStore), basket(candidateStore, { missing: true })),
    scenario(basket(baselineStore), basket(candidateStore, { activeDays: [m2DefaultActiveDays[0]] })),
    scenario(basket(baselineStore), basket(baselineStore)),
    scenario(basket(baselineStore), basket(candidateStore)),
  ]
  for (const current of cases) {
    const guidance = comparisonNextStep(current)
    assert.ok(guidance.title.length > 10)
    assert.ok(guidance.action.length > 10)
    assert.ok(guidance.explanation.length > 10)
    assert.doesNotMatch(
      [guidance.title, guidance.explanation, guidance.action].join(' '),
      /M2|M3|testfixture|claimable|undefined|NaN/i,
    )
  }
})

test('claimable money must retain a complete ingredient-level trace, not merely consistent totals', () => {
  const value = scenario(basket(baselineStore), basket(candidateStore, { priceDelta: -10 }))
  const lines = value.comparison.lineDeltas
  assert.ok(lines.length >= 2)
  assert.equal(comparisonNextStep(value).canShowDifference, true)
  const initialSnapshot = JSON.stringify(value)
  const variants = [
    lines.slice(1),
    null,
    [...lines.slice(0, -1), { ...lines.at(-1), id: 'not-a-basket-line' }],
    [...lines.slice(0, -1), { ...lines.at(-1), ingredientLabel: 'Wrong label' }],
    [...lines.slice(0, -1), { ...lines.at(-1), deltaCents: lines.at(-1).deltaCents + 1 }],
    [...lines.slice(0, -1), { ...lines.at(-1), candidateLineTotalCents: lines.at(-1).candidateLineTotalCents + 1 }],
    [lines[0], ...lines.slice(0, -1)],
  ]
  for (const lineDeltas of variants) {
    const guidance = comparisonNextStep({
      ...value,
      comparison: { ...value.comparison, lineDeltas },
    })
    assert.equal(guidance.code, 'review-data')
    assert.equal(guidance.canShowDifference, false)
  }
  assert.equal(
    comparisonNextStep({
      ...value,
      comparison: { ...value.comparison, lineDeltas: [...lines].reverse() },
    }).canShowDifference,
    true,
    'order should not affect the same valid per-ingredient trace',
  )
  assert.equal(JSON.stringify(value), initialSnapshot, 'presentation guidance cannot mutate inputs')
})

test('malformed nested basket rows are rejected without leaking a JavaScript TypeError', () => {
  const value = scenario(basket(baselineStore), basket(candidateStore))
  assert.equal(comparisonNextStep(value).canShowDifference, true)
  for (const malformed of [null, undefined, 3, 'matched', []]) {
    const changed = {
      ...value,
      baseline: {
        ...value.baseline,
        lines: [malformed, ...value.baseline.lines.slice(1)],
      },
    }
    assert.doesNotThrow(() => comparisonNextStep(changed))
    assert.equal(comparisonNextStep(changed).code, 'review-data')
    assert.equal(comparisonNextStep(changed).canShowDifference, false)
  }
})
