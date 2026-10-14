import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { comparisonNextStep } from '../src/features/basket/comparisonNextStep.ts'
import { m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

const baselineStore = { id: 'qa-week-matrix-a', name: 'Gecontroleerde voorbeeldwinkel A' }
const candidateStore = { id: 'qa-week-matrix-b', name: 'Gecontroleerde voorbeeldwinkel B' }
const days = m2InitialPlan.map((meal) => meal.day)

function catalog(store, priceDelta) {
  return [
    ...m2Products.map((p) => ({
      ...p,
      id: `${store.id}:${p.id}`,
      storeId: store.id,
      priceCents: p.priceCents + priceDelta,
    })),
    {
      id: `${store.id}:garam`,
      storeId: store.id,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      priceCents: 139 + priceDelta,
      available: true,
    },
  ]
}

function build(store, activeDays, priceDelta = 0, { reverse = false } = {}) {
  return buildOneStoreBasket({
    store,
    plan: reverse ? [...m2InitialPlan].reverse() : m2InitialPlan,
    recipes: reverse ? [...m2Recipes].reverse() : m2Recipes,
    activeDays,
    products: reverse ? catalog(store, priceDelta).reverse() : catalog(store, priceDelta),
  })
}

function completeComparison(baseline, candidate) {
  assert.equal(baseline.unresolvedLineCount, 0)
  assert.equal(candidate.unresolvedLineCount, 0)
  const comparison = compareFullBaskets({ baseline, candidate })
  assert.equal(comparison.claimable, true, comparison.reasons.join('; '))
  return comparison
}

test('15 nonempty active-week combinations × 7 price contexts retain transparent, exact basket guidance', () => {
  let samples = 0
  for (let mask = 1; mask < (1 << days.length); mask += 1) {
    const selectedDays = days.filter((_, index) => (mask & (1 << index)) !== 0)
    for (const change of [-17, -3, -1, 0, 1, 3, 17]) {
      const baseline = build(baselineStore, selectedDays)
      const candidate = build(candidateStore, selectedDays, change)
      const comparison = completeComparison(baseline, candidate)
      const snapshot = JSON.stringify({ baseline, candidate, comparison })
      const guidance = comparisonNextStep({ baseline, candidate, comparison })

      assert.equal(guidance.code, 'comparison-ready')
      assert.equal(guidance.canShowDifference, true)
      assert.match(guidance.explanation, /geen actuele winkelprijzen/)
      assert.match(guidance.explanation, /geen.*besparingen/)
      assert.equal(comparison.lineDeltas.length, baseline.lines.length)
      assert.equal(
        comparison.lineDeltas.reduce((sum, delta) => sum + delta.deltaCents, 0),
        comparison.deltaCents,
      )
      assert.equal(
        comparison.outcome,
        change < 0 ? 'better' : change > 0 ? 'worse' : 'same',
      )
      assert.equal(JSON.stringify({ baseline, candidate, comparison }), snapshot)
      samples += 1
    }
  }
  assert.equal(samples, 105)
})

test('basket, recipe and product input order does not change controlled comparison guidance', () => {
  let samples = 0
  for (let mask = 1; mask < (1 << days.length); mask += 1) {
    const selectedDays = days.filter((_, index) => (mask & (1 << index)) !== 0)
    for (const price of [-5, 0, 7]) {
      const left = {
        baseline: build(baselineStore, selectedDays),
        candidate: build(candidateStore, selectedDays, price),
      }
      const right = {
        baseline: build(baselineStore, [...selectedDays].reverse(), 0, { reverse: true }),
        candidate: build(candidateStore, [...selectedDays].reverse(), price, { reverse: true }),
      }
      const normal = completeComparison(left.baseline, left.candidate)
      const reordered = completeComparison(right.baseline, right.candidate)
      assert.equal(normal.deltaCents, reordered.deltaCents)
      assert.equal(normal.savingsCents, reordered.savingsCents)
      assert.equal(normal.outcome, reordered.outcome)
      assert.deepEqual(
        normal.lineDeltas.map((line) => [line.id, line.deltaCents]),
        reordered.lineDeltas.map((line) => [line.id, line.deltaCents]),
      )
      assert.deepEqual(
        comparisonNextStep({ ...left, comparison: normal }),
        comparisonNextStep({ ...right, comparison: reordered }),
      )
      samples += 1
    }
  }
  assert.equal(samples, 45)
})

test('each active-week pattern with one unresolved store ingredient fails closed', () => {
  let verified = 0
  for (let mask = 1; mask < (1 << days.length); mask += 1) {
    const selectedDays = days.filter((_, index) => (mask & (1 << index)) !== 0)
    const complete = build(baselineStore, selectedDays)
    const candidate = build(candidateStore, selectedDays)
    const matchedLine = candidate.lines.find((line) => line.status === 'matched')
    assert.ok(matchedLine)
    const changed = {
      ...candidate,
      lines: candidate.lines.map((line) =>
        line.id === matchedLine.id
          ? {
              id: line.id,
              ingredientLabel: line.ingredientLabel,
              requirement: line.requirement,
              status: 'unresolved',
              reasons: ['synthetic missing product'],
              matchScore: null,
            }
          : line,
      ),
      matchedLineCount: candidate.matchedLineCount - 1,
      unresolvedLineCount: candidate.unresolvedLineCount + 1,
      totalCents: candidate.totalCents - matchedLine.lineTotalCents,
    }
    const comparison = compareFullBaskets({ baseline: complete, candidate: changed })
    assert.equal(comparison.claimable, false)
    const guidance = comparisonNextStep({ baseline: complete, candidate: changed, comparison })
    assert.equal(guidance.code, 'complete-products')
    assert.equal(guidance.canShowDifference, false)
    assert.doesNotMatch(JSON.stringify(guidance), /synthetic missing product/)
    verified += 1
  }
  assert.equal(verified, 15)
})
