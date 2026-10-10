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
    studyId: 'week-2026-40-runtime-text',
    participantKey: 'student-runtime-text-001',
    population: 'independently living students',
    region: 'Leiden',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'basket-runtime-text-a',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Manual cart observation.',
      basket: basket(baselineStore, 0),
    },
    candidate: {
      evidenceId: 'basket-runtime-text-b',
      observedAt: '2026-10-02T18:15:00Z',
      source: 'manual-cart',
      provenanceNote: 'Manual cart observation.',
      basket: basket(candidateStore, -10),
    },
  }
}

function assertFailsClosed(value, reason) {
  let result
  assert.doesNotThrow(() => {
    result = assessWeeklyBasketStudy(value)
  })
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.savingsCents, null)
  assert.match(result.reasons.join(' '), reason)
}

test('M3 assessment rejects non-string top-level study text without coercion', () => {
  const cases = [
    ['studyId', { toString: () => 'week-2026-40-runtime-text' }, /studyId is not a path-safe study key/],
    ['participantKey', { toString: () => 'student-runtime-text-001' }, /participantKey must be a pseudonymous path-safe key/],
    ['population', { trim: () => 'independently living students' }, /population is required/],
    ['region', 42, /region is required/],
    ['weekStart', { toString: () => '2026-09-28' }, /weekStart must be a valid YYYY-MM-DD date/],
  ]

  for (const [field, malformed, reason] of cases) {
    const value = validStudy()
    value[field] = malformed
    assertFailsClosed(value, reason)
  }
})

test('M3 assessment rejects non-string evidence text without coercion', () => {
  const cases = [
    ['evidenceId', { toString: () => 'basket-runtime-text-a' }, /baseline evidenceId is not a path-safe evidence key/],
    ['provenanceNote', { trim: () => 'Manual cart observation.' }, /baseline evidence provenance note is required/],
    ['observedAt', { toString: () => '2026-10-02T17:00:00Z' }, /baseline observedAt is not a valid timestamp/],
  ]

  for (const [field, malformed, reason] of cases) {
    const value = validStudy()
    value.baseline = { ...value.baseline, [field]: malformed }
    assertFailsClosed(value, reason)
  }
})

test('M3 assessment preserves valid study behavior after runtime text hardening', () => {
  const result = assessWeeklyBasketStudy(validStudy())

  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
  assert.ok(result.comparison.savingsCents > 0)
  assert.equal(result.observationWindowHours, 1.25)
  assert.deepEqual(result.reasons, [])
})
