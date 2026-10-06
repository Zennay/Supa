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
    studyId: 'week-2026-40-a',
    participantKey: 'student-001',
    population: 'independently living students',
    region: 'Leiden',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'basket-a-001',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Manual cart observation recorded for study protocol.',
      basket: basket(baselineStore),
    },
    candidate: {
      evidenceId: 'basket-b-001',
      observedAt: '2026-10-02T18:15:00Z',
      source: 'manual-cart',
      provenanceNote: 'Manual cart observation recorded for study protocol.',
      basket: basket(candidateStore, -10),
    },
  }
}

test('M3 assessment rejects non-string top-level metadata without coercion or crashes', () => {
  const value = validStudy()
  value.studyId = { toString: () => 'week-2026-40-a' }
  value.participantKey = { toString: () => 'student-001' }
  value.population = null
  value.region = 123
  value.weekStart = { toString: () => '2026-09-28' }

  const result = assessWeeklyBasketStudy(value)

  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.match(result.reasons.join(' '), /studyId is not a path-safe study key/)
  assert.match(
    result.reasons.join(' '),
    /participantKey must be a pseudonymous path-safe key/,
  )
  assert.match(result.reasons.join(' '), /population is required/)
  assert.match(result.reasons.join(' '), /region is required/)
  assert.match(
    result.reasons.join(' '),
    /weekStart must be a valid YYYY-MM-DD date/,
  )
})

test('M3 assessment rejects malformed evidence metadata without coercion or crashes', () => {
  const value = validStudy()
  value.baseline = {
    ...value.baseline,
    evidenceId: { toString: () => 'basket-a-001' },
    observedAt: { toString: () => '2026-10-02T17:00:00Z' },
    source: 42,
    provenanceNote: null,
  }

  const result = assessWeeklyBasketStudy(value)

  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.observationWindowHours, null)
  assert.match(
    result.reasons.join(' '),
    /baseline evidenceId is not a path-safe evidence key/,
  )
  assert.match(
    result.reasons.join(' '),
    /baseline evidence source is not an allowed observed source/,
  )
  assert.match(
    result.reasons.join(' '),
    /baseline evidence provenance note is required/,
  )
  assert.match(
    result.reasons.join(' '),
    /baseline observedAt is not a valid timestamp/,
  )
})
