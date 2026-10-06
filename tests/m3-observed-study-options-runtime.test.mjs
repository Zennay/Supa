import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

const baselineStore = { id: 'observed-a', name: 'Observed store A' }
const candidateStore = { id: 'observed-b', name: 'Observed store B' }

function completeProducts(storeId, delta = 0) {
  return [
    ...m2Products.map((product) => ({
      ...product,
      id: `${storeId}-${product.id}`,
      storeId,
      priceCents: product.priceCents + delta,
    })),
    {
      id: `${storeId}-garam-50`,
      storeId,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + delta,
    },
  ]
}

function basket(store, delta = 0) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: completeProducts(store.id, delta),
  })
}

function validStudy() {
  return {
    schemaVersion: 1,
    studyId: 'week-2026-40-runtime',
    participantKey: 'student-runtime-001',
    population: 'independently living students',
    region: 'Leiden',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'basket-runtime-a',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Manual cart observation.',
      basket: basket(baselineStore, 0),
    },
    candidate: {
      evidenceId: 'basket-runtime-b',
      observedAt: '2026-10-02T18:15:00Z',
      source: 'manual-cart',
      provenanceNote: 'Manual cart observation.',
      basket: basket(candidateStore, -10),
    },
  }
}

test('M3 assessment fails closed for malformed option containers', () => {
  for (const malformed of [null, '24', 24, true, []]) {
    const result = assessWeeklyBasketStudy(validStudy(), malformed)

    assert.equal(result.claimable, false)
    assert.equal(result.comparison.outcome, 'unknown')
    assert.equal(result.comparison.savingsCents, null)
    assert.match(
      result.reasons.join(' '),
      /assessment options must be a non-array object/,
    )
    assert.equal(result.observationWindowHours, 1.25)
  }
})

test('M3 assessment rejects non-number window values without coercion', () => {
  const result = assessWeeklyBasketStudy(validStudy(), {
    maxObservationWindowHours: '24',
  })

  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.match(
    result.reasons.join(' '),
    /maxObservationWindowHours must be a positive finite number/,
  )
})
