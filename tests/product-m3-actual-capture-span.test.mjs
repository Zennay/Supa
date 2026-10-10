import assert from 'node:assert/strict'
import test from 'node:test'

import { projectFreshControlledComparisonCatalogs } from '../src/data/trustedMultipackComparisonCatalog.ts'
import { assessControlledSourceBasketReadiness } from '../src/data/controlledSourceBasketReadiness.ts'

// All stores, prices, timestamps and identifiers are synthetic. These tests
// exercise the opt-in projection boundary, never real retailer evidence.
const referenceTime = '2026-10-10T12:00:00Z'
const baselineStore = { id: 'fixture-plus', supermarket: 'plus' }
const candidateStore = { id: 'fixture-deka', supermarket: 'dekamarkt' }

function row(supermarket, capturedAt) {
  return {
    supermarket, sourceProductId: 'synthetic-rice',
    name: 'Basmati rijst', currentPriceCents: 249, currency: 'EUR',
    pack: { rawText: '1 kg', amount: 1, unit: 'kg' },
    offer: null, availability: 'available',
    provenance: {
      supermarket, kind: 'product',
      url: supermarket === 'plus'
        ? 'https://www.plus.nl/synthetic-rice'
        : 'https://www.dekamarkt.nl/synthetic-rice',
      capturedAt, sha256: 'e'.repeat(64),
    },
  }
}

function input(plusTime, dekaTime) {
  return {
    baselineStore, candidateStore, referenceTime,
    baselineObservations: [row('plus', plusTime)],
    candidateObservations: [row('dekamarkt', dekaTime)],
  }
}

test('equal valid timestamps 23h before reference mean ZERO hours between captures', () => {
  const given = input('2026-10-09T13:00:00Z', '2026-10-09T13:00:00Z')
  const untouched = structuredClone(given)
  const result = projectFreshControlledComparisonCatalogs(given)
  assert.ok(result)
  assert.equal(result.captureWindowHours, 0)
  assert.deepEqual(given, untouched)
})

test('span is between earliest and latest retailer observations, not reference-age', () => {
  const result = projectFreshControlledComparisonCatalogs(
    input('2026-10-09T13:00:00Z', '2026-10-09T14:00:00Z'),
  )
  assert.ok(result)
  assert.equal(result.captureWindowHours, 1)
})

test('calendar-offset equivalents share one instant even when reference is later', () => {
  const result = projectFreshControlledComparisonCatalogs(
    input('2026-10-09T15:00:00+02:00', '2026-10-09T13:00:00Z'),
  )
  assert.ok(result)
  assert.equal(result.captureWindowHours, 0)
})

test('exact genuine 24h capture spread is inclusive, but older-than-reference remains forbidden', () => {
  const boundary = projectFreshControlledComparisonCatalogs(
    input('2026-10-09T12:00:00Z', '2026-10-10T12:00:00Z'),
  )
  assert.ok(boundary)
  assert.equal(boundary.captureWindowHours, 24)

  const stale = projectFreshControlledComparisonCatalogs(
    input('2026-10-09T11:59:59Z', '2026-10-09T12:59:59Z'),
  )
  assert.equal(stale, null)
})

test('source-only basket preflight reports actual cross-retailer spread, never time-since-collection', () => {
  const plan = [{ day: 'Ma', recipeId: 'rice' }]
  const recipes = [{
    id: 'rice', title: 'Synthetic rice', minutes: 10,
    servings: 1, estimatedCost: 0, tags: [],
    ingredients: [{
      id: 'basmati-rice', label: 'Basmati rijst', query: 'basmati rijst',
      amount: 450, unit: 'g',
    }],
  }]
  const result = assessControlledSourceBasketReadiness({
    ...input('2026-10-09T13:00:00Z', '2026-10-09T14:00:00Z'),
    plan, recipes, activeDays: ['Ma'],
  })
  assert.equal(result.status, 'structural-pass')
  assert.equal(result.captureWindowHours, 1)
  assert.equal(result.releaseEligible, false)
  assert.equal(Object.hasOwn(result, 'savingsCents'), false)
})
