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

function study(overrides = {}) {
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
      basket: basket(baselineStore, 0),
    },
    candidate: {
      evidenceId: 'basket-b-001',
      observedAt: '2026-10-02T18:15:00Z',
      source: 'manual-cart',
      provenanceNote: 'Manual cart observation recorded for study protocol.',
      basket: basket(candidateStore, -10),
    },
    ...overrides,
  }
}

test('M3 observed-basket study accepts comparable evidence in one time window', () => {
  const result = assessWeeklyBasketStudy(study())

  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
  assert.ok(result.comparison.savingsCents > 0)
  assert.equal(result.observationWindowHours, 1.25)
  assert.deepEqual(result.reasons, [])
})


test('M3 observed-basket study accepts explicit timezone offsets', () => {
  const value = study()
  value.baseline = {
    ...value.baseline,
    observedAt: '2026-10-02T19:00:00+02:00',
  }
  value.candidate = {
    ...value.candidate,
    observedAt: '2026-10-02T20:15:00+02:00',
  }

  const result = assessWeeklyBasketStudy(value)

  assert.equal(result.claimable, true)
  assert.equal(result.observationWindowHours, 1.25)
  assert.deepEqual(result.reasons, [])
})

test('M3 observed-basket study preserves a worse observed outcome', () => {
  const value = study()
  value.candidate = {
    ...value.candidate,
    basket: basket(candidateStore, 25),
  }

  const result = assessWeeklyBasketStudy(value)

  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'worse')
  assert.ok(result.comparison.savingsCents < 0)
})

test('M3 observed-basket study fails closed when observations are too far apart', () => {
  const value = study()
  value.candidate = {
    ...value.candidate,
    observedAt: '2026-10-04T18:15:00Z',
  }

  const result = assessWeeklyBasketStudy(value)

  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.savingsCents, null)
  assert.match(result.reasons.join(' '), /max is 24h/)
})


test('M3 observed-basket study cannot disable the time window with non-finite configuration', () => {
  const result = assessWeeklyBasketStudy(study(), {
    maxObservationWindowHours: Number.POSITIVE_INFINITY,
  })

  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.match(
    result.reasons.join(' '),
    /maxObservationWindowHours must be a positive finite number/,
  )
})

test('M3 observed-basket study rejects non-positive time-window configuration', () => {
  const result = assessWeeklyBasketStudy(study(), {
    maxObservationWindowHours: 0,
  })

  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.match(
    result.reasons.join(' '),
    /maxObservationWindowHours must be a positive finite number/,
  )
})

test('M3 observed-basket study fails closed without an explicit price context', () => {
  const value = study()
  value.priceContext = 'mixed-channel'

  const result = assessWeeklyBasketStudy(value)

  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.match(result.reasons.join(' '), /priceContext/)
})


test('M3 observed-basket study rejects impossible calendar week dates', () => {
  const result = assessWeeklyBasketStudy(study({ weekStart: '2026-02-31' }))

  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.match(result.reasons.join(' '), /weekStart must be a valid YYYY-MM-DD date/)
})

test('M3 observed-basket study rejects date-only observation timestamps', () => {
  const value = study()
  value.baseline = {
    ...value.baseline,
    observedAt: '2026-10-02',
  }

  const result = assessWeeklyBasketStudy(value)

  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.observationWindowHours, null)
  assert.match(result.reasons.join(' '), /baseline observedAt is not a valid timestamp/)
})

test('M3 observed-basket study rejects impossible observation timestamps', () => {
  const value = study()
  value.candidate = {
    ...value.candidate,
    observedAt: '2026-02-31T18:15:00Z',
  }

  const result = assessWeeklyBasketStudy(value)

  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.observationWindowHours, null)
  assert.match(result.reasons.join(' '), /candidate observedAt is not a valid timestamp/)
})

test('M3 observed-basket study rejects non-observed fixture-style source labels', () => {
  const value = study()
  value.baseline = {
    ...value.baseline,
    source: 'controlled-fixture',
  }

  const result = assessWeeklyBasketStudy(value)

  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.match(result.reasons.join(' '), /not an allowed observed source/)
})

test('M3 observed-basket study carries basket uncertainty into study claimability', () => {
  const value = study()
  value.candidate = {
    ...value.candidate,
    basket: buildOneStoreBasket({
      store: candidateStore,
      plan: m2InitialPlan,
      recipes: m2Recipes,
      activeDays: m2DefaultActiveDays,
      products: completeProducts(candidateStore.id, -10).filter(
        (product) => !product.id.endsWith('garam-50'),
      ),
    }),
  }

  const result = assessWeeklyBasketStudy(value)

  assert.equal(result.claimable, false)
  assert.equal(result.comparison.outcome, 'unknown')
  assert.equal(result.comparison.savingsCents, null)
  assert.match(result.reasons.join(' '), /unresolved ingredients/)
})

test('M3 observed-basket study requires pseudonymous path-safe participant keys', () => {
  const result = assessWeeklyBasketStudy(
    study({ participantKey: 'Jane Doe <jane@example.com>' }),
  )

  assert.equal(result.claimable, false)
  assert.match(result.reasons.join(' '), /pseudonymous path-safe key/)
})
