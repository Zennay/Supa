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

function productsForStore(
  storeId,
  priceDeltaCents = 0,
  priceKind = 'unknown',
) {
  return [
    ...m2Products.map((product) => ({
      ...product,
      id: `${storeId}-${product.id}`,
      storeId,
      priceCents: Math.max(0, product.priceCents + priceDeltaCents),
      priceKind,
      regularPriceCents:
        priceKind === 'offer' ? product.priceCents : null,
    })),
    {
      id: `${storeId}-garam-50`,
      storeId,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + priceDeltaCents,
      priceKind,
      regularPriceCents: priceKind === 'offer' ? 139 : null,
    },
  ]
}

function buildCompleteBasket(
  store,
  priceDeltaCents = 0,
  activeDays = m2DefaultActiveDays,
  priceKind = 'unknown',
) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays,
    products: productsForStore(store.id, priceDeltaCents, priceKind),
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
  assert.equal(comparison.attribution.fullyAttributed, false)
  assert.equal(comparison.attribution.unknownCents, comparison.deltaCents)
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


test('M3 attributes a trusted same-pack discount to offers', () => {
  const baseline = buildCompleteBasket(
    baselineStore,
    0,
    m2DefaultActiveDays,
    'regular',
  )
  const candidate = buildCompleteBasket(
    candidateStore,
    -10,
    m2DefaultActiveDays,
    'offer',
  )

  const comparison = compareFullBaskets({ baseline, candidate })

  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'better')
  assert.equal(comparison.attribution.fullyAttributed, true)
  assert.equal(comparison.attribution.packSizeCents, 0)
  assert.equal(comparison.attribution.planningCents, 0)
  assert.equal(comparison.attribution.offerCents, comparison.deltaCents)
  assert.equal(comparison.attribution.unknownCents, 0)
})

test('M3 attributes same-unit-price overspend to pack size', () => {
  const baselineProducts = productsForStore(
    baselineStore.id,
    0,
    'regular',
  )
  const candidateProducts = productsForStore(
    candidateStore.id,
    0,
    'regular',
  ).map((product) =>
    product.id.endsWith('basmati-1kg')
      ? {
          ...product,
          name: 'Basmati rijst 2 kg',
          packAmount: 2,
          packUnit: 'kg',
          priceCents: 498,
          regularPriceCents: 498,
        }
      : product,
  )

  const baseline = buildOneStoreBasket({
    store: baselineStore,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: baselineProducts,
  })
  const candidate = buildOneStoreBasket({
    store: candidateStore,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: candidateProducts,
  })

  const comparison = compareFullBaskets({ baseline, candidate })

  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'worse')
  assert.equal(comparison.deltaCents, 249)
  assert.equal(comparison.attribution.fullyAttributed, true)
  assert.equal(comparison.attribution.packSizeCents, 249)
  assert.equal(comparison.attribution.offerCents, 0)
  assert.equal(comparison.attribution.planningCents, 0)
  assert.equal(comparison.attribution.unknownCents, 0)
})
