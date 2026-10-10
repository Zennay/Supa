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

// Synthetic, controlled fixtures only. Never use these as field/savings evidence.
function basket(store, priceDelta = 0) {
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${store.id}-${product.id}`,
      storeId: store.id,
      priceCents: product.priceCents + priceDelta,
    })),
    {
      id: `${store.id}-garam-50`,
      storeId: store.id,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + priceDelta,
    },
  ]
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
}

function validStudy() {
  return {
    schemaVersion: 1,
    studyId: 'qa-week-2026-40',
    participantKey: 'qa-student-001',
    population: 'synthetic QA students',
    region: 'test-region',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'qa-evidence-plus',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic QA-only observation.',
      basket: basket({ id: 'qa-plus', name: 'QA PLUS' }),
    },
    candidate: {
      evidenceId: 'qa-evidence-deka',
      observedAt: '2026-10-02T18:15:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic QA-only observation.',
      basket: basket({ id: 'qa-deka', name: 'QA DekaMarkt' }, -10),
    },
  }
}

test('QA M3 malformed-evidence control: genuine-shaped synthetic two-store fixture stays comparable', () => {
  const study = validStudy()
  const before = structuredClone(study)
  const result = assessWeeklyBasketStudy(study)

  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
  assert.ok(result.comparison.savingsCents > 0)
  assert.equal(result.observationWindowHours, 1.25)
  assert.deepEqual(study, before)
})

function expectUnclaimable(value, caseName) {
  const before = structuredClone(value)
  let result
  assert.doesNotThrow(() => {
    result = assessWeeklyBasketStudy(value)
  }, `${caseName}: malformed runtime JSON must not crash M3 assessment`)
  assert.equal(result.claimable, false, caseName)
  assert.equal(result.comparison.outcome, 'unknown', caseName)
  assert.equal(result.comparison.savingsCents, null, caseName)
  assert.equal(result.comparison.deltaCents, null, caseName)
  assert.deepEqual(result.comparison.lineDeltas, [], caseName)
  assert.ok(result.reasons.length > 0, `${caseName}: explain why assessment was rejected`)
  assert.deepEqual(value, before, `${caseName}: input must not be mutated`)
}

for (const [caseName, invalid] of [
  ['null study root', null],
  ['array study root', []],
  ['numeric study root', 123],
  ['empty study root', {}],
]) {
  test(`QA M3 observed-study rejects ${caseName} without throwing`, () => {
    expectUnclaimable(invalid, caseName)
  })
}

for (const [caseName, alter] of [
  ['missing baseline', (study) => { delete study.baseline }],
  ['null baseline', (study) => { study.baseline = null }],
  ['numeric candidate', (study) => { study.candidate = 1 }],
  ['array candidate', (study) => { study.candidate = [] }],
]) {
  test(`QA M3 observed-study rejects ${caseName} without throwing`, () => {
    const value = validStudy()
    alter(value)
    expectUnclaimable(value, caseName)
  })
}
