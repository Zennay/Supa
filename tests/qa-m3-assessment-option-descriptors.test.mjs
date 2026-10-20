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

function assertPrivacySafeUnknown(options) {
  const result = assessWeeklyBasketStudy(validStudy(), options)
  assert.equal(result.claimable, false)
  assert.equal(result.comparison.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.deltaCents, null)
  assert.equal(result.comparison.savingsCents, null)
  assert.equal(result.attribution.fullyAttributed, false)
  assert.match(result.reasons.join(' '), /options/i)
  assert.doesNotMatch(result.reasons.join(' '), /secret|token|private-person/i)
}

test('QA #1220: revoked options Proxy fails closed instead of throwing in Array.isArray', () => {
  const proxy = Proxy.revocable({}, {})
  proxy.revoke()
  assertPrivacySafeUnknown(proxy.proxy)
})

test('QA #1220: trapping Proxy fails closed without touching option values', () => {
  let propertyReads = 0
  const options = new Proxy({}, {
    get() {
      propertyReads += 1
      throw new Error('private-person token should never be read')
    },
  })
  const result = assessWeeklyBasketStudy(validStudy(), options)
  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
  assert.equal(propertyReads, 0)
})

test('QA #1220: own throwing max-window getter is never executed', () => {
  let accessed = false
  const options = Object.defineProperty({}, 'maxObservationWindowHours', {
    enumerable: true,
    get() {
      accessed = true
      throw new Error('private-person secret')
    },
  })
  assertPrivacySafeUnknown(options)
  assert.equal(accessed, false)
})

test('QA #1220: own getter returning 24h is not accepted as a data-backed value', () => {
  let reads = 0
  const options = Object.defineProperty({}, 'maxObservationWindowHours', {
    get() {
      reads += 1
      return 24
    },
  })
  assertPrivacySafeUnknown(options)
  assert.equal(reads, 0)
})

test('QA #1220: inherited throwing getter is never executed', () => {
  let reads = 0
  const parent = Object.defineProperty({}, 'maxObservationWindowHours', {
    get() {
      reads += 1
      throw new Error('private-person secret')
    },
  })
  const options = Object.create(parent)
  assertPrivacySafeUnknown(options)
  assert.equal(reads, 0)
})

test('QA #1220: inherited data value must not silently validate an option', () => {
  const options = Object.create({ maxObservationWindowHours: 24 })
  assertPrivacySafeUnknown(options)
})

test('QA #1220: options must not invoke Proxy get trap even when it supplies 24h', () => {
  let reads = 0
  const options = new Proxy({}, {
    get(_, key) {
      if (key === 'maxObservationWindowHours') {
        reads += 1
        return 24
      }
      return undefined
    },
  })
  const result = assessWeeklyBasketStudy(validStudy(), options)
  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
  assert.equal(reads, 0)
})

test('QA #1220: frozen own data options remain valid', () => {
  const result = assessWeeklyBasketStudy(
    validStudy(),
    Object.freeze({ maxObservationWindowHours: 12 }),
  )
  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
  assert.equal(result.observationWindowHours, 1.25)
})

test('QA #1220: frozen null-prototype own data options remain valid', () => {
  const options = Object.freeze(
    Object.assign(Object.create(null), { maxObservationWindowHours: 24 }),
  )
  const result = assessWeeklyBasketStudy(validStudy(), options)
  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
  assert.equal(result.observationWindowHours, 1.25)
})

test('QA #1220: default plain options remain valid', () => {
  const result = assessWeeklyBasketStudy(validStudy(), {})
  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
})
