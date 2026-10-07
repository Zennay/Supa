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
  id: 'runtime-baseline-store',
  name: 'Runtime baseline store',
}

const candidateStore = {
  id: 'runtime-candidate-store',
  name: 'Runtime candidate store',
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

function buildCompleteBasket(store, priceDeltaCents = 0) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: productsForStore(store.id, priceDeltaCents),
  })
}

function hideMatchedLineBehindUnsupportedStatus(basket) {
  const index = basket.lines.findIndex((line) => line.status === 'matched')
  assert.ok(index >= 0)

  const line = basket.lines[index]
  assert.equal(line.status, 'matched')

  basket.lines[index] = {
    ...line,
    status: 'ignored-runtime-status',
  }
  basket.totalCents -= line.lineTotalCents
  basket.matchedLineCount -= 1
}

test('M3 comparison fails closed when a runtime line uses an unsupported status', () => {
  const baseline = buildCompleteBasket(baselineStore, 0)
  const candidate = buildCompleteBasket(candidateStore, -10)

  hideMatchedLineBehindUnsupportedStatus(baseline)
  hideMatchedLineBehindUnsupportedStatus(candidate)

  const comparison = compareFullBaskets({ baseline, candidate })

  assert.equal(comparison.claimable, false)
  assert.equal(comparison.outcome, 'unknown')
  assert.equal(comparison.deltaCents, null)
  assert.equal(comparison.savingsCents, null)
  assert.equal(comparison.lineDeltas.length, 0)
  assert.match(
    comparison.reasons.join(' '),
    /unsupported line shape or status/,
  )
})

test('M3 comparison returns unknown instead of throwing when runtime lines are not an array', () => {
  const baseline = buildCompleteBasket(baselineStore, 0)
  const candidate = buildCompleteBasket(candidateStore, -10)

  baseline.lines = { malformed: true }

  const comparison = compareFullBaskets({ baseline, candidate })

  assert.equal(comparison.claimable, false)
  assert.equal(comparison.outcome, 'unknown')
  assert.equal(comparison.deltaCents, null)
  assert.equal(comparison.savingsCents, null)
  assert.match(comparison.reasons.join(' '), /lines are not an array/)
})


test('M3 comparison fails closed when whitespace padding disguises the same store identity', () => {
  for (const paddedStoreId of [
    ` ${baselineStore.id}`,
    `${baselineStore.id} `,
  ]) {
    const baseline = buildCompleteBasket(baselineStore, 0)
    const candidate = buildCompleteBasket(
      {
        ...candidateStore,
        id: paddedStoreId,
      },
      -10,
    )

    const comparison = compareFullBaskets({ baseline, candidate })

    assert.equal(comparison.claimable, false)
    assert.equal(comparison.outcome, 'unknown')
    assert.equal(comparison.deltaCents, null)
    assert.equal(comparison.savingsCents, null)
    assert.equal(comparison.lineDeltas.length, 0)
    assert.match(comparison.reasons.join(' '), /invalid store identity/)
    assert.match(
      comparison.reasons.join(' '),
      /baseline and candidate stores must differ/,
    )
  }
})
