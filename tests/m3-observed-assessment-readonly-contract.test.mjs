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

// Synthetic research fixtures only: no actual retailer prices or savings evidence.
const baselineStore = { id: 'qa-observed-a', name: 'QA store A' }
const candidateStore = { id: 'qa-observed-b', name: 'QA store B' }

function frozenCopy(value) {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      frozenCopy(child)
    }
  }
  return Object.freeze(value)
}

function basket(store, offsetCents) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: [
      ...m2Products.map((product) => ({
        ...product,
        id: `${store.id}-${product.id}`,
        storeId: store.id,
        priceCents: product.priceCents + offsetCents,
      })),
      {
        id: `${store.id}-garam-50`,
        storeId: store.id,
        name: 'Garam masala 50 g',
        packAmount: 50,
        packUnit: 'g',
        priceCents: 139 + offsetCents,
        available: true,
      },
    ],
  })
}

function study() {
  return {
    schemaVersion: 1,
    studyId: 'qa-evidence-preservation',
    participantKey: 'qa-synthetic-participant',
    population: 'synthetic students',
    region: 'synthetic region',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'qa-baseline-001',
      observedAt: '2026-10-08T14:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic baseline, never collected from a customer.',
      basket: basket(baselineStore, 0),
    },
    candidate: {
      evidenceId: 'qa-candidate-001',
      observedAt: '2026-10-08T15:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic candidate, never collected from a customer.',
      basket: basket(candidateStore, -10),
    },
  }
}

test('M3 assessment is reproducible and read-only on frozen complete research inputs', () => {
  const input = study()
  assert.equal(input.baseline.basket.unresolvedLineCount, 0)
  assert.equal(input.candidate.basket.unresolvedLineCount, 0)
  const snapshot = structuredClone(input)
  frozenCopy(input)

  const first = assessWeeklyBasketStudy(input)
  const second = assessWeeklyBasketStudy(input)

  assert.equal(first.claimable, true)
  assert.equal(first.comparison.outcome, 'better')
  assert.deepEqual(second, first)
  assert.deepEqual(input, snapshot, 'assessment must never rewrite original evidence')
})

test('M3 invalid evidence remains frozen and produces repeatable unknown results', () => {
  const input = study()
  input.candidate.basket.totalCents += 1
  const snapshot = structuredClone(input)
  frozenCopy(input)

  const first = assessWeeklyBasketStudy(input)
  const second = assessWeeklyBasketStudy(input)

  assert.equal(first.claimable, false)
  assert.equal(first.comparison.outcome, 'unknown')
  assert.equal(first.comparison.deltaCents, null)
  assert.equal(first.comparison.savingsCents, null)
  assert.deepEqual(first.comparison.lineDeltas, [])
  assert.deepEqual(second, first)
  assert.deepEqual(input, snapshot, 'invalid study must remain intact for review')
})
