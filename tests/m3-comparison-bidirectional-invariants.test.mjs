import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

// Synthetic controlled prices only. This is NOT an observed PLUS/DekaMarkt study.
const baselineStore = { id: 'synthetic-baseline', name: 'Synthetic baseline' }
const candidateStore = { id: 'synthetic-candidate', name: 'Synthetic candidate' }

function pricedProducts(storeId, priceOffsetCents) {
  return [
    ...m2Products.map((product) => ({
      ...product,
      id: `${storeId}-${product.id}`,
      storeId,
      priceCents: product.priceCents + priceOffsetCents,
    })),
    {
      id: `${storeId}-garam-masala`,
      storeId,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + priceOffsetCents,
    },
  ]
}

function basket(store, priceOffsetCents, activeDays) {
  const result = buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays,
    products: pricedProducts(store.id, priceOffsetCents),
  })
  assert.equal(result.unresolvedLineCount, 0, 'synthetic fixture must be complete')
  assert.ok(result.selectedMealCount > 0)
  return result
}

function deltasById(comparison) {
  return Object.fromEntries(
    comparison.lineDeltas.map(({ id, deltaCents }) => [id, deltaCents]),
  )
}

test('M3 complete-basket reversal preserves cents and reverses financial direction across weekly scopes', () => {
  const scopes = [m2DefaultActiveDays, m2DefaultActiveDays.slice(0, 2)]
  const candidateOffsets = [-10, 0, 25, 100]

  for (const activeDays of scopes) {
    const baseline = basket(baselineStore, 0, activeDays)

    for (const offset of candidateOffsets) {
      const candidate = basket(candidateStore, offset, activeDays)
      const forward = compareFullBaskets({ baseline, candidate })
      const backward = compareFullBaskets({ baseline: candidate, candidate: baseline })

      assert.equal(forward.claimable, true, `forward offset ${offset}`)
      assert.equal(backward.claimable, true, `backward offset ${offset}`)
      assert.deepEqual(forward.reasons, [])
      assert.deepEqual(backward.reasons, [])
      assert.equal(forward.baselineTotalCents, backward.candidateTotalCents)
      assert.equal(forward.candidateTotalCents, backward.baselineTotalCents)
      assert.equal(forward.deltaCents + backward.deltaCents, 0)
      assert.equal(forward.savingsCents + backward.savingsCents, 0)
      assert.equal(forward.deltaCents + forward.savingsCents, 0)
      assert.equal(forward.lineDeltas.length, baseline.matchedLineCount)
      assert.equal(backward.lineDeltas.length, candidate.matchedLineCount)

      const reverseLines = deltasById(backward)
      for (const [id, delta] of Object.entries(deltasById(forward))) {
        assert.ok(Object.hasOwn(reverseLines, id), `reverse must retain ${id}`)
        assert.equal(delta + reverseLines[id], 0, `reverse must negate ${id}`)
      }

      const expected = offset < 0 ? 'better' : offset > 0 ? 'worse' : 'same'
      const reversed = offset < 0 ? 'worse' : offset > 0 ? 'better' : 'same'
      assert.equal(forward.outcome, expected)
      assert.equal(backward.outcome, reversed)
    }
  }
})

test('M3 full-basket comparison does not depend on unordered collected ingredient lines', () => {
  const baseline = basket(baselineStore, 0, m2DefaultActiveDays)
  const candidate = basket(candidateStore, -10, m2DefaultActiveDays)
  const expected = compareFullBaskets({ baseline, candidate })

  const reordered = compareFullBaskets({
    baseline: { ...baseline, lines: [...baseline.lines].reverse() },
    candidate: {
      ...candidate,
      lines: [...candidate.lines].sort((a, b) => b.id.localeCompare(a.id)),
    },
  })

  assert.equal(expected.claimable, true)
  assert.equal(reordered.claimable, true)
  assert.equal(expected.outcome, reordered.outcome)
  assert.equal(expected.deltaCents, reordered.deltaCents)
  assert.equal(expected.savingsCents, reordered.savingsCents)
  assert.deepEqual(deltasById(expected), deltasById(reordered))
})

test('M3 a missing candidate ingredient stays unknown in both directions, not an apparent saving', () => {
  const baseline = basket(baselineStore, 0, m2DefaultActiveDays)
  const candidate = basket(candidateStore, -10, m2DefaultActiveDays)
  const withoutOneLine = {
    ...candidate,
    lines: candidate.lines.slice(1),
    matchedLineCount: candidate.matchedLineCount - 1,
    totalCents: candidate.totalCents - candidate.lines[0].lineTotalCents,
  }

  for (const pair of [
    { baseline, candidate: withoutOneLine },
    { baseline: withoutOneLine, candidate: baseline },
  ]) {
    const result = compareFullBaskets(pair)
    assert.equal(result.claimable, false)
    assert.equal(result.outcome, 'unknown')
    assert.equal(result.deltaCents, null)
    assert.equal(result.savingsCents, null)
    assert.deepEqual(result.lineDeltas, [])
    assert.match(result.reasons.join(' '), /ingredient coverage differs|missing ingredient|extra ingredient/)
  }
})
