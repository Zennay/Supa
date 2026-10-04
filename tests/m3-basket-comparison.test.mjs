import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

const baselineStore = {
  ...m2Store,
  id: 'm3-baseline-store',
  name: 'M3 baseline store',
}

const candidateStore = {
  id: 'm3-candidate-store',
  name: 'M3 candidate store',
}

function productsForStore(storeId, priceDeltaCents = 0) {
  return [
    ...m2Products.map((product) => ({
      ...product,
      id: `${storeId}-${product.id}`,
      storeId,
      priceCents: Math.max(0, product.priceCents + priceDeltaCents),
    })),
    {
      id: `${storeId}-garam-50`,
      storeId,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + priceDeltaCents,
    },
  ]
}

function buildCompleteBasket(store, priceDeltaCents = 0, activeDays = m2DefaultActiveDays) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays,
    products: productsForStore(store.id, priceDeltaCents),
  })
}

test('M3 compares the same complete basket against an explicit baseline', () => {
  const baseline = buildCompleteBasket(baselineStore, 0)
  const candidate = buildCompleteBasket(candidateStore, -10)

  assert.equal(baseline.unresolvedLineCount, 0)
  assert.equal(candidate.unresolvedLineCount, 0)

  const comparison = compareFullBaskets({ baseline, candidate })

  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'better')
  assert.ok(comparison.savingsCents > 0)
  assert.equal(
    comparison.savingsCents,
    baseline.totalCents - candidate.totalCents,
  )
  assert.equal(comparison.lineDeltas.length, baseline.matchedLineCount)
  assert.equal(comparison.attribution.planning.status, 'known')
  assert.equal(comparison.attribution.planning.deltaCents, 0)
  assert.equal(comparison.attribution.packSize.status, 'known')
  assert.equal(comparison.attribution.packSize.deltaCents, 0)
  assert.equal(comparison.attribution.offer.status, 'unknown')
  assert.equal(comparison.attribution.offer.deltaCents, null)
  assert.equal(comparison.attribution.unattributedCents, comparison.deltaCents)
  assert.deepEqual(comparison.reasons, [])
})

test('M3 preserves a worse full-basket result instead of hiding it', () => {
  const baseline = buildCompleteBasket(baselineStore, 0)
  const candidate = buildCompleteBasket(candidateStore, 25)

  const comparison = compareFullBaskets({ baseline, candidate })

  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'worse')
  assert.ok(comparison.savingsCents < 0)
  assert.ok(comparison.deltaCents > 0)
})

test('M3 returns unknown when a superficially cheaper basket is incomplete', () => {
  const baseline = buildCompleteBasket(baselineStore, 0)
  const incompleteProducts = productsForStore(candidateStore.id, -25).filter(
    (product) => !product.id.endsWith('garam-50'),
  )
  const candidate = buildOneStoreBasket({
    store: candidateStore,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: incompleteProducts,
  })

  assert.ok(candidate.totalCents < baseline.totalCents)
  assert.equal(candidate.unresolvedLineCount, 1)

  const comparison = compareFullBaskets({ baseline, candidate })

  assert.equal(comparison.claimable, false)
  assert.equal(comparison.outcome, 'unknown')
  assert.equal(comparison.savingsCents, null)
  assert.equal(comparison.deltaCents, null)
  assert.equal(comparison.attribution.planning.status, 'unknown')
  assert.equal(comparison.attribution.packSize.status, 'unknown')
  assert.equal(comparison.attribution.offer.status, 'unknown')
  assert.equal(comparison.attribution.unattributedCents, null)
  assert.match(comparison.reasons.join(' '), /unresolved ingredients/)
})

test('M3 returns unknown when the compared baskets represent different meal demand', () => {
  const baseline = buildCompleteBasket(baselineStore, 0)
  const candidate = buildCompleteBasket(
    candidateStore,
    -10,
    m2DefaultActiveDays.slice(0, -1),
  )

  const comparison = compareFullBaskets({ baseline, candidate })

  assert.equal(comparison.claimable, false)
  assert.equal(comparison.outcome, 'unknown')
  assert.equal(comparison.savingsCents, null)
  assert.match(
    comparison.reasons.join(' '),
    /different number of meals|ingredient demand differs|coverage differs/,
  )
})

test('M3 records a neutral result when comparable baskets cost the same', () => {
  const baseline = buildCompleteBasket(baselineStore, 0)
  const candidate = buildCompleteBasket(candidateStore, 0)

  const comparison = compareFullBaskets({ baseline, candidate })

  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'same')
  assert.equal(comparison.deltaCents, 0)
  assert.equal(comparison.savingsCents, 0)
})

test('M3 marks pack-size attribution unknown when pack geometry differs', () => {
  const baseline = buildCompleteBasket(baselineStore, 0)
  const candidateProducts = productsForStore(candidateStore.id, 0).map((product) =>
    product.id.endsWith('chicken-400')
      ? { ...product, packAmount: 300, name: 'Kippendij 300 g' }
      : product,
  )
  const candidate = buildOneStoreBasket({
    store: candidateStore,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: candidateProducts,
  })

  const comparison = compareFullBaskets({ baseline, candidate })

  assert.equal(comparison.claimable, true)
  assert.equal(comparison.attribution.planning.status, 'known')
  assert.equal(comparison.attribution.packSize.status, 'unknown')
  assert.match(
    comparison.attribution.packSize.reasons.join(' '),
    /pack-size effect cannot be isolated/,
  )
  assert.equal(comparison.attribution.offer.status, 'unknown')
})
