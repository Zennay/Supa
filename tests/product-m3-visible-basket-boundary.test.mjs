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

function build(store, products) {
  return buildOneStoreBasket({
    store, products, plan: m2InitialPlan,
    activeDays: m2DefaultActiveDays, recipes: m2Recipes,
  })
}

function completeSnapshots() {
  const baseline = build(m3BaselineStore, m3BaselineProducts)
  const candidate = build(m3CandidateStore, m3CandidateProducts)
  const comparison = compareFullBaskets({ baseline, candidate })
  assert.equal(comparison.claimable, true)
  assert.equal(baseline.unresolvedLineCount, 0)
  assert.equal(candidate.unresolvedLineCount, 0)
  return { baseline, candidate, comparison }
}

test('visible M3 baskets: valid real M2-controlled fixture retains a truthful headline', () => {
  const { baseline, candidate, comparison } = completeSnapshots()
  assert.equal(basketComparisonCanShowMoney(comparison, candidate, baseline), true)
  assert.notEqual(basketComparisonHeadline(comparison, candidate, baseline), 'Nog geen betrouwbare vergelijking')
})

test('visible M3 baskets: stale comparator cannot claim money for different displayed snapshots', async (t) => {
  const { baseline, candidate, comparison } = completeSnapshots()
  const variants = [
    ['baseline total changed after comparison', ({ baseline }) => { baseline.totalCents += 1 }],
    ['candidate total changed after comparison', ({ candidate }) => { candidate.totalCents += 1 }],
    ['candidate ingredient requirement changed', ({ candidate }) => {
      const line = candidate.lines.find((item) => item.status === 'matched')
      assert.ok(line)
      line.requirement.amount *= 2
    }],
    ['candidate requirement unit changed', ({ candidate }) => {
      const line = candidate.lines.find((item) => item.status === 'matched')
      assert.ok(line)
      line.requirement.unit = line.requirement.unit === 'g' ? 'ml' : 'g'
    }],
    ['matched candidate pack price changed', ({ candidate }) => {
      const line = candidate.lines.find((item) => item.status === 'matched')
      assert.ok(line)
      line.pricePerPackCents += 1
    }],
    ['candidate store changed to baseline store', ({ baseline, candidate }) => {
      candidate.store.id = baseline.store.id
    }],
    ['candidate matched row disappeared', ({ candidate }) => { candidate.lines.pop() }],
    ['candidate ingredient identity mutated', ({ candidate }) => {
      candidate.lines[0].id = 'stale-different-ingredient'
    }],
    ['candidate label mutated', ({ candidate }) => {
      candidate.lines[0].ingredientLabel = 'Ander ingrediënt'
    }],
  ]

  for (const [name, mutate] of variants) {
    await t.test(name, () => {
      const baskets = {
        baseline: structuredClone(baseline),
        candidate: structuredClone(candidate),
      }
      mutate(baskets)
      // Both baskets are current UI props; only the comparison remains stale.
      assert.equal(
        basketComparisonCanShowMoney(comparison, baskets.candidate, baskets.baseline),
        false,
        name,
      )
      assert.equal(
        basketComparisonHeadline(comparison, baskets.candidate, baskets.baseline),
        'Nog geen betrouwbare vergelijking',
        name,
      )
    })
  }
})

test('visible M3 baskets: line order does not invalidate an otherwise identical comparator', () => {
  const { baseline, candidate, comparison } = completeSnapshots()
  const shuffled = structuredClone(comparison)
  shuffled.lineDeltas.reverse()
  assert.equal(basketComparisonCanShowMoney(shuffled, candidate, baseline), true)
})
