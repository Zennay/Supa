import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore, m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'
import {
  basketComparisonCanShowMoney, basketComparisonHeadline, comparisonLineHighlights,
} from '../src/features/basket/basketPresentation.ts'

function fixture(store, products) {
  return buildOneStoreBasket({
    store, products, recipes: m2Recipes,
    plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
  })
}

function currentBaskets() {
  const baseline = fixture(m3BaselineStore, m3BaselineProducts)
  const candidate = fixture(m3CandidateStore, m3CandidateProducts)
  const comparison = compareFullBaskets({ baseline, candidate })
  assert.equal(comparison.claimable, true)
  assert.equal(comparison.reasons.length, 0)
  return { baseline, candidate, comparison }
}

test('postrepair: controlled M2-to-M3 current basket display permits fully consistent comparison', () => {
  const { baseline, candidate, comparison } = currentBaskets()
  assert.equal(basketComparisonCanShowMoney(comparison, candidate, baseline), true)
  assert.notEqual(
    basketComparisonHeadline(comparison, candidate, baseline),
    'Nog geen betrouwbare vergelijking',
  )
  assert.ok(comparisonLineHighlights(comparison).length > 0)
})

test('postrepair: stale demands or matching economics cannot borrow earlier identical cents', async (t) => {
  const { baseline, candidate, comparison } = currentBaskets()
  const cases = [
    ['baseline demand changed', ({ baseline }) => {
      const line = baseline.lines.find((l) => l.status === 'matched')
      assert.ok(line)
      line.requirement.amount *= 3
    }],
    ['candidate match confidence regressed', ({ candidate }) => {
      const line = candidate.lines.find((l) => l.status === 'matched')
      assert.ok(line)
      line.matchScore = 0
    }],
    ['candidate pack multiplicity tampered', ({ candidate }) => {
      const line = candidate.lines.find((l) => l.status === 'matched')
      assert.ok(line)
      line.pack.count = 0
    }],
    ['baseline product identity missing', ({ baseline }) => {
      const line = baseline.lines.find((l) => l.status === 'matched')
      assert.ok(line)
      line.productId = ''
    }],
    ['candidate detail label changes with same cents', ({ candidate }) => {
      candidate.lines[0].ingredientLabel = 'Stale ander ingrediënt'
    }],
    ['candidate store became same as baseline', ({ baseline, candidate }) => {
      candidate.store.id = baseline.store.id
    }],
  ]
  for (const [label, mutate] of cases) {
    await t.test(label, () => {
      const current = {
        baseline: structuredClone(baseline),
        candidate: structuredClone(candidate),
      }
      mutate(current)
      assert.equal(
        basketComparisonCanShowMoney(comparison, current.candidate, current.baseline),
        false,
      )
      assert.equal(
        basketComparisonHeadline(comparison, current.candidate, current.baseline),
        'Nog geen betrouwbare vergelijking',
      )
    })
  }
})

test('postrepair: line order changes do not cause a false abstention', () => {
  const { baseline, candidate, comparison } = currentBaskets()
  const reversed = structuredClone(comparison)
  reversed.lineDeltas.reverse()
  assert.equal(basketComparisonCanShowMoney(reversed, candidate, baseline), true)
  assert.notEqual(basketComparisonHeadline(reversed, candidate, baseline), 'Nog geen betrouwbare vergelijking')
})

test('postrepair: BasketView passes both currently visible basket snapshots to money gates', async () => {
  const view = await readFile(new URL('../src/features/basket/BasketView.tsx', import.meta.url), 'utf8')
  assert.match(view, /basketComparisonCanShowMoney\(\s*comparison,\s*comparisonCandidate,\s*comparisonBaseline,\s*\)/)
  assert.match(view, /basketComparisonHeadline\(comparison, comparisonCandidate, comparisonBaseline\)/)
  assert.match(view, /comparisonCanShowMoney\s*\?\s*comparisonLineHighlights\(comparison\)/)
  assert.match(view, /comparisonCanShowMoney\s*\?\s*\(/)
})

test('postrepair: explicit null displayed baseline cannot bypass the financial gate', () => {
  const { candidate, comparison } = currentBaskets()
  assert.equal(basketComparisonCanShowMoney(comparison, candidate, null), false)
  assert.equal(
    basketComparisonHeadline(comparison, candidate, null),
    'Nog geen betrouwbare vergelijking',
  )
})
