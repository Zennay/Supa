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

// Controlled fixture prices only: these are not PLUS/DekaMarkt observations.
const stores = [
  { id: 'synthetic-baseline-qa', name: 'Synthetic baseline' },
  { id: 'synthetic-candidate-qa', name: 'Synthetic candidate' },
]

function basket(store, offsetCents) {
  const products = [
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
      available: true,
      priceCents: 139 + offsetCents,
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

function syntheticStudy() {
  return {
    schemaVersion: 1,
    studyId: 'synthetic-study-001',
    participantKey: 'synthetic-student-001',
    population: 'Synthetic independently living students',
    region: 'Synthetic QA region',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'synthetic-evidence-a',
      observedAt: '2026-10-05T11:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic test data, not field evidence.',
      basket: basket(stores[0], 0),
    },
    candidate: {
      evidenceId: 'synthetic-evidence-b',
      observedAt: '2026-10-05T12:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic test data, not field evidence.',
      basket: basket(stores[1], -5),
    },
  }
}

function assertUnknownWithoutSavings(assessment, expectedReason) {
  assert.equal(assessment.claimable, false)
  assert.equal(assessment.comparison.claimable, false)
  assert.equal(assessment.comparison.outcome, 'unknown')
  assert.equal(assessment.comparison.deltaCents, null)
  assert.equal(assessment.comparison.savingsCents, null)
  assert.deepEqual(assessment.comparison.lineDeltas, [])
  assert.match(assessment.reasons.join(' | '), expectedReason)
}

test('M3 accepts every explicitly allowed observation source pair in both price contexts', () => {
  const sources = ['manual-cart', 'receipt', 'consented-export']
  let combinations = 0
  for (const priceContext of ['in-store', 'online-order']) {
    for (const baselineSource of sources) {
      for (const candidateSource of sources) {
        const study = syntheticStudy()
        study.priceContext = priceContext
        study.baseline.source = baselineSource
        study.candidate.source = candidateSource
        const original = structuredClone(study)
        const assessment = assessWeeklyBasketStudy(study)

        assert.equal(
          assessment.claimable,
          true,
          `${priceContext} / ${baselineSource} / ${candidateSource}: ${assessment.reasons.join('; ')}`,
        )
        assert.equal(assessment.comparison.outcome, 'better')
        assert.equal(assessment.observationWindowHours, 1)
        assert.deepEqual(assessment.reasons, [])
        assert.deepEqual(study, original, 'validation must never rewrite study evidence')
        combinations++
      }
    }
  }
  assert.equal(combinations, 18)
})

test('M3 invalid evidence identity, source or study metadata suppresses all savings values', () => {
  const invalid = [
    ['colliding evidence IDs', (s) => { s.candidate.evidenceId = s.baseline.evidenceId }, /evidence IDs must differ/],
    ['traversal evidence ID', (s) => { s.baseline.evidenceId = '../secret' }, /path-safe evidence key/],
    ['short evidence ID', (s) => { s.candidate.evidenceId = 'a' }, /path-safe evidence key/],
    ['email participant key', (s) => { s.participantKey = 'person@example.invalid' }, /pseudonymous path-safe key/],
    ['path traversal participant key', (s) => { s.participantKey = '../data' }, /pseudonymous path-safe key/],
    ['path traversal study ID', (s) => { s.studyId = '../study' }, /path-safe study key/],
    ['blank region', (s) => { s.region = '  ' }, /region is required/],
    ['blank population', (s) => { s.population = '  ' }, /population is required/],
    ['invalid week', (s) => { s.weekStart = '2026-02-31' }, /weekStart must be a valid/],
    ['mixed price context', (s) => { s.priceContext = 'in-store+online-order' }, /priceContext must/],
    ['unknown source', (s) => { s.candidate.source = 'synthetic-fixture' }, /not an allowed observed source/],
    ['missing provenance', (s) => { s.baseline.provenanceNote = '  ' }, /provenance note is required/],
    ['date-only time', (s) => { s.candidate.observedAt = '2026-10-05' }, /not a valid timestamp/],
    ['invalid attribution container', (s) => { s.attributionEvidence = {} }, /attributionEvidence must be an array/],
    ['identical store IDs', (s) => { s.candidate.basket.store.id = s.baseline.basket.store.id }, /stores must differ/],
  ]

  for (const [label, mutate, reason] of invalid) {
    const study = syntheticStudy()
    mutate(study)
    const original = structuredClone(study)
    const assessment = assessWeeklyBasketStudy(study)
    assertUnknownWithoutSavings(assessment, reason)
    assert.deepEqual(study, original, `${label}: invalid evidence mutated`)
  }
  assert.equal(invalid.length, 15)
})

test('M3 validity is independent from the order of distinct source/evidence identifiers', () => {
  const study = syntheticStudy()
  const original = structuredClone(study)
  const forward = assessWeeklyBasketStudy(study)

  const swapped = structuredClone(study)
  const priorBaseline = swapped.baseline
  swapped.baseline = swapped.candidate
  swapped.candidate = priorBaseline
  const reverse = assessWeeklyBasketStudy(swapped)

  assert.equal(forward.claimable, true)
  assert.equal(reverse.claimable, true)
  assert.equal(forward.comparison.savingsCents, -reverse.comparison.savingsCents)
  assert.equal(forward.comparison.deltaCents, -reverse.comparison.deltaCents)
  assert.equal(forward.observationWindowHours, reverse.observationWindowHours)
  assert.deepEqual(study, original)
})
