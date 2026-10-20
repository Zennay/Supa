import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// Controlled fixture data only. The matching basket prices, stores and
// timestamps are NOT human field measurements or public savings evidence.
function basket(store, discountCents) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: [
      ...m2Products.map(product => ({
        ...product,
        id: store.id + '-' + product.id,
        storeId: store.id,
        priceCents: product.priceCents - discountCents,
      })),
      {
        id: store.id + '-spice-synthetic',
        storeId: store.id,
        name: 'Garam masala 50 g',
        packAmount: 50,
        packUnit: 'g',
        available: true,
        priceCents: 139 - discountCents,
      },
    ],
  })
}

function study(candidateAt) {
  const baselineStore = { id: 'plus-synthetic', name: 'PLUS test fixture' }
  const candidateStore = { id: 'deka-synthetic', name: 'DekaMarkt test fixture' }
  return {
    schemaVersion: 1,
    studyId: 'synthetic-window-proof',
    participantKey: 'anonymous-fixture-only',
    population: 'controlled fixture',
    region: 'synthetic-only',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'synthetic-a',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Fictional fixture, no real retail visit.',
      basket: basket(baselineStore, 0),
    },
    candidate: {
      evidenceId: 'synthetic-b',
      observedAt: candidateAt,
      source: 'manual-cart',
      provenanceNote: 'Fictional fixture, no real retail visit.',
      basket: basket(candidateStore, 10),
    },
  }
}

function assertSafeRejection(result, elapsed) {
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.savingsCents, null)
  assert.equal(result.observationWindowHours, elapsed)
  assert.ok(result.reasons.some(reason => /24h/.test(reason)), 'must cite canonical 24h limit')
  assert.doesNotMatch(result.reasons.join(' '), /anonymous-fixture|synthetic-window-proof/i)
}

test('canonical 24h is inclusive with the fixed direct M3 assessment window', () => {
  const result = assessWeeklyBasketStudy(study('2026-10-03T17:00:00Z'))
  assert.equal(result.claimable, true)
  assert.equal(result.observationWindowHours, 24)
  assert.equal(result.comparison.outcome, 'better')
  assert.ok(result.comparison.savingsCents > 0)
})

for (const [label, candidateAt, optionHours, elapsed] of [
  ['25h observed pair with caller-supplied 25h', '2026-10-03T18:00:00Z', 25, 25],
  ['48h observed pair with caller-supplied 72h', '2026-10-04T17:00:00Z', 72, 48],
  ['48h observed pair with a very large finite caller window', '2026-10-04T17:00:00Z', 1000000, 48],
]) {
  test(`direct M3 savings cannot expand the human 24h protocol: ${label}`, () => {
    const value = study(candidateAt)
    assertSafeRejection(assessWeeklyBasketStudy(value, {
      maxObservationWindowHours: optionHours,
    }), elapsed)
  })
}

test('a stricter 12h caller window is preserved and rejects a 13h pair', () => {
  const result = assessWeeklyBasketStudy(study('2026-10-03T06:00:00Z'), {
    maxObservationWindowHours: 12,
  })
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.savingsCents, null)
  assert.equal(result.observationWindowHours, 13)
})

test('even a generous override cannot hide a 24h + 1ms window', () => {
  const result = assessWeeklyBasketStudy(study('2026-10-03T17:00:00.001Z'), {
    maxObservationWindowHours: 72,
  })
  assertSafeRejection(result, 24 + 0.001 / 3600)
})
