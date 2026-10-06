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

const baselineStore = { id: 'observed-runtime-a', name: 'Observed runtime A' }
const candidateStore = { id: 'observed-runtime-b', name: 'Observed runtime B' }

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
    studyId: 'week-2026-40-text-runtime',
    participantKey: 'student-text-runtime-001',
    population: 'independently living students',
    region: 'Leiden',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'basket-text-runtime-a',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Manual cart observation.',
      basket: basket(baselineStore, 0),
    },
    candidate: {
      evidenceId: 'basket-text-runtime-b',
      observedAt: '2026-10-02T18:15:00Z',
      source: 'manual-cart',
      provenanceNote: 'Manual cart observation.',
      basket: basket(candidateStore, -10),
    },
  }
}

test('M3 assessment fails closed on non-string study text fields without throwing', () => {
  const cases = [
    {
      mutate: (value) => { value.studyId = 42 },
      reason: /studyId is not a path-safe study key/,
    },
    {
      mutate: (value) => { value.participantKey = [] },
      reason: /participantKey must be a pseudonymous path-safe key/,
    },
    {
      mutate: (value) => { value.population = null },
      reason: /population is required/,
    },
    {
      mutate: (value) => { value.region = { name: 'Leiden' } },
      reason: /region is required/,
    },
    {
      mutate: (value) => { value.weekStart = 20260928 },
      reason: /weekStart must be a valid YYYY-MM-DD date/,
    },
  ]

  for (const entry of cases) {
    const value = validStudy()
    entry.mutate(value)

    const result = assessWeeklyBasketStudy(value)

    assert.equal(result.claimable, false)
    assert.equal(result.comparison.outcome, 'unknown')
    assert.equal(result.comparison.savingsCents, null)
    assert.match(result.reasons.join(' '), entry.reason)
  }
})

test('M3 assessment fails closed on non-string evidence text fields without throwing', () => {
  const cases = [
    {
      mutate: (value) => { value.baseline.evidenceId = { id: 'bad' } },
      reason: /baseline evidenceId is not a path-safe evidence key/,
    },
    {
      mutate: (value) => { value.baseline.provenanceNote = null },
      reason: /baseline evidence provenance note is required/,
    },
    {
      mutate: (value) => { value.baseline.observedAt = 1_759_424_400_000 },
      reason: /baseline observedAt is not a valid timestamp/,
    },
    {
      mutate: (value) => { value.candidate.evidenceId = true },
      reason: /candidate evidenceId is not a path-safe evidence key/,
    },
    {
      mutate: (value) => { value.candidate.provenanceNote = ['manual'] },
      reason: /candidate evidence provenance note is required/,
    },
    {
      mutate: (value) => { value.candidate.observedAt = { iso: '2026-10-02T18:15:00Z' } },
      reason: /candidate observedAt is not a valid timestamp/,
    },
  ]

  for (const entry of cases) {
    const value = validStudy()
    entry.mutate(value)

    const result = assessWeeklyBasketStudy(value)

    assert.equal(result.claimable, false)
    assert.equal(result.comparison.outcome, 'unknown')
    assert.equal(result.comparison.savingsCents, null)
    assert.match(result.reasons.join(' '), entry.reason)
  }
})


test('M3 assessment fails closed on malformed study containers without throwing', () => {
  for (const value of [null, [], 'study', 42]) {
    const result = assessWeeklyBasketStudy(value)

    assert.equal(result.claimable, false)
    assert.equal(result.comparison.outcome, 'unknown')
    assert.equal(result.comparison.baselineTotalCents, 0)
    assert.equal(result.comparison.candidateTotalCents, 0)
    assert.equal(result.observationWindowHours, null)
    assert.match(result.reasons.join(' '), /study must be a non-array object/)
  }
})

test('M3 assessment fails closed on malformed evidence containers without throwing', () => {
  const cases = [
    {
      mutate: (value) => { value.baseline = null },
      reason: /baseline evidence must be a non-array object/,
    },
    {
      mutate: (value) => { value.candidate = [] },
      reason: /candidate evidence must be a non-array object/,
    },
    {
      mutate: (value) => { value.baseline.basket = null },
      reason: /baseline basket must be a non-array object/,
    },
    {
      mutate: (value) => { value.candidate.basket.store = null },
      reason: /candidate basket store must be a non-array object/,
    },
  ]

  for (const entry of cases) {
    const value = validStudy()
    entry.mutate(value)

    const result = assessWeeklyBasketStudy(value)

    assert.equal(result.claimable, false)
    assert.equal(result.comparison.outcome, 'unknown')
    assert.equal(result.comparison.savingsCents, null)
    assert.match(result.reasons.join(' '), entry.reason)
  }
})
