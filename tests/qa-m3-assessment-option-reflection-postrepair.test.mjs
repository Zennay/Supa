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

function assertUnclaimable(options) {
  const assessment = assessWeeklyBasketStudy(validStudy(), options)
  assert.equal(assessment.claimable, false)
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.equal(assessment.comparison.deltaCents, null)
  assert.equal(assessment.comparison.savingsCents, null)
  assert.equal(assessment.attribution.fullyAttributed, false)
  assert.match(assessment.reasons.join(' '), /options/i)
  assert.doesNotMatch(assessment.reasons.join(' '), /private-operator-code|sensitive-marker/i)
}

test('QA #1220 postrepair: a revoked array Proxy fails closed at IsArray reflection', () => {
  const wrapped = Proxy.revocable([], {})
  wrapped.revoke()
  assertUnclaimable(wrapped.proxy)
})

test('QA #1220 postrepair: a getPrototypeOf trap failure is contained', () => {
  let reads = 0
  const options = new Proxy({}, {
    getPrototypeOf() {
      throw new Error('private-operator-code')
    },
    get() {
      reads += 1
      throw new Error('sensitive-marker')
    },
  })
  assertUnclaimable(options)
  assert.equal(reads, 0)
})

test('QA #1220 postrepair: a getOwnPropertyDescriptor trap failure is contained', () => {
  let reads = 0
  const options = new Proxy({}, {
    getOwnPropertyDescriptor() {
      throw new Error('private-operator-code')
    },
    get() {
      reads += 1
      throw new Error('sensitive-marker')
    },
  })
  assertUnclaimable(options)
  assert.equal(reads, 0)
})

test('QA #1220 postrepair: descriptor trap supplying accessor never executes it', () => {
  let reads = 0
  const target = {}
  Object.defineProperty(target, 'maxObservationWindowHours', {
    configurable: true,
    get() {
      reads += 1
      throw new Error('sensitive-marker')
    },
  })
  const options = new Proxy(target, {})
  assertUnclaimable(options)
  assert.equal(reads, 0)
})

test('QA #1220 postrepair: null-prototype absent optional window uses safe default', () => {
  const options = Object.freeze(Object.create(null))
  const assessment = assessWeeklyBasketStudy(validStudy(), options)
  assert.equal(assessment.claimable, true)
  assert.equal(assessment.comparison.outcome, 'better')
  assert.equal(assessment.observationWindowHours, 1.25)
})

test('QA #1220 postrepair: sealed numeric own window retains stricter bound', () => {
  const options = Object.seal({ maxObservationWindowHours: 1 })
  const assessment = assessWeeklyBasketStudy(validStudy(), options)
  assert.equal(assessment.claimable, false)
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.equal(assessment.comparison.savingsCents, null)
  assert.match(assessment.reasons.join(' '), /max is 1h/)
})

test('QA #1220 postrepair: frozen own 24h option is accepted without coercion', () => {
  const options = Object.freeze({ maxObservationWindowHours: 24 })
  const assessment = assessWeeklyBasketStudy(validStudy(), options)
  assert.equal(assessment.claimable, true)
  assert.equal(assessment.comparison.outcome, 'better')
})

test('QA #1220 postrepair: own coercion-bearing object never executes valueOf', () => {
  let reads = 0
  const suspicious = {
    valueOf() {
      reads += 1
      throw new Error('sensitive-marker')
    },
  }
  assertUnclaimable({ maxObservationWindowHours: suspicious })
  assert.equal(reads, 0)
})
