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

// Fictional research evidence only. All 11 canonical M2 ingredients are
// populated from the controlled, non-retailer test fixture.
function makeBasket(store, deltaCents) {
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${store.id}-${product.id}`,
      storeId: store.id,
      priceCents: product.priceCents + deltaCents,
    })),
    {
      id: `${store.id}-garam-50`,
      storeId: store.id,
      name: 'Fictional garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + deltaCents,
    },
  ]
  const basket = buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
  assert.equal(basket.matchedLineCount, 11)
  assert.equal(basket.unresolvedLineCount, 0)
  return basket
}

function fictionalObservedWeek(weekStart = '2026-09-28') {
  return {
    schemaVersion: 1,
    studyId: 'qa-week-coherence-001',
    participantKey: 'synthetic-001',
    population: 'fictional student cohort',
    region: 'fictional region',
    weekStart,
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'fictional-plus-001',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic offline fixture, NOT actual PLUS prices.',
      basket: makeBasket({ id: 'plus-fictional', name: 'PLUS (fictional)' }, 0),
    },
    candidate: {
      evidenceId: 'fictional-deka-001',
      observedAt: '2026-10-02T18:15:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic offline fixture, NOT actual DekaMarkt prices.',
      basket: makeBasket({ id: 'dekamarkt-fictional', name: 'DekaMarkt (fictional)' }, -10),
    },
  }
}

test('QA M3: observation week and timestamps align for a complete synthetic same-demand basket', () => {
  const study = fictionalObservedWeek()
  const original = JSON.stringify(study)
  const result = assessWeeklyBasketStudy(study)

  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
  assert.equal(result.observationWindowHours, 1.25)
  assert.equal(result.comparison.lineDeltas.length, 11)
  assert.equal(result.attribution.status, 'partial')
  assert.equal(JSON.stringify(study), original, 'assessment must not mutate evidence')
})

for (const distantWeek of ['2025-09-29', '2027-09-27']) {
  test(`QA M3 EXPECTED RED: observation from Oct 2026 cannot prove week ${distantWeek}`, () => {
    const study = fictionalObservedWeek(distantWeek)
    const original = JSON.stringify(study)
    const result = assessWeeklyBasketStudy(study)

    assert.equal(result.observationWindowHours, 1.25)
    assert.equal(result.claimable, false, 'unrelated study week must fail closed')
    assert.equal(result.comparison.outcome, 'unknown')
    assert.equal(result.comparison.deltaCents, null)
    assert.equal(result.comparison.savingsCents, null)
    assert.equal(result.attribution.fullyAttributed, false)
    assert.match(result.reasons.join(' '), /weekStart|week|observation|observed/i)
    assert.equal(JSON.stringify(study), original, 'original evidence must remain byte-identical')
  })
}
