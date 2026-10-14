import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// M2 synthetic baskets only; no genuine retailer observation.
function basket(store, discount = 0) {
  const products = [
    ...m2Products.map((product) => ({
      ...product, id: store.id + '-' + product.id, storeId: store.id,
      priceCents: product.priceCents + discount,
    })),
    {
      id: store.id + '-garam-masala', storeId: store.id,
      name: 'Garam masala 50 g', packAmount: 50, packUnit: 'g',
      available: true, priceCents: 139 + discount,
    },
  ]
  return buildOneStoreBasket({
    store, products, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
  })
}

function study() {
  const baselineStore = { id: 'plus-qa-test', name: 'PLUS fictief' }
  const candidateStore = { id: 'dekamarkt-qa-test', name: 'DekaMarkt fictief' }
  return {
    schemaVersion: 1, studyId: 'qa-m3-visible-metadata-001',
    participantKey: 'student-pseudonym-001',
    population: 'uitwonende studenten', region: 'Leiden',
    weekStart: '2026-10-05', priceContext: 'in-store',
    baseline: {
      evidenceId: 'qa-plus-001', observedAt: '2026-10-05T10:00:00Z',
      source: 'manual-cart', provenanceNote: 'Fictieve PLUS observatie voor QA.',
      basket: basket(baselineStore),
    },
    candidate: {
      evidenceId: 'qa-dekamarkt-001', observedAt: '2026-10-05T11:00:00Z',
      source: 'manual-cart', provenanceNote: 'Fictieve DekaMarkt observatie voor QA.',
      basket: basket(candidateStore, -10),
    },
  }
}

// Expected RED on current M3 study evaluator: String.trim does not remove
// every visually blank mark/format codepoint. This is a synthetic proof
// boundary, not a leak or evidence that real store savings occurred.
for (const [field, code, invisible] of [
  ['population', 'ZERO WIDTH SPACE', '\u200B'],
  ['region', 'WORD JOINER', '\u2060'],
  ['baseline.provenanceNote', 'COMBINING GRAPHEME JOINER', '\u034F'],
  ['candidate.provenanceNote', 'ZERO WIDTH JOINER', '\u200D'],
  ['baseline.provenanceNote', 'COMBINING ACUTE', '\u0301'],
  ['region', 'mixed invisible mark-format', '\u200B\u0301\u2060'],
]) {
  test('M3 QA expected RED: ' + field + ' with ' + code + ' alone cannot substantiate a claim', () => {
    const s = study()
    const original = structuredClone(s)
    if (field === 'population') s.population = invisible
    if (field === 'region') s.region = invisible
    if (field === 'baseline.provenanceNote') s.baseline.provenanceNote = invisible
    if (field === 'candidate.provenanceNote') s.candidate.provenanceNote = invisible
    const assessed = assessWeeklyBasketStudy(s)
    assert.equal(assessed.claimable, false)
    assert.equal(assessed.comparison.claimable, false)
    assert.equal(assessed.comparison.outcome, 'unknown')
    assert.equal(assessed.comparison.deltaCents, null)
    assert.equal(assessed.comparison.savingsCents, null)
    assert.deepEqual(assessed.comparison.lineDeltas, [])
    assert.match(assessed.reasons.join(' '), /population|region|provenance note/)
    if (field === 'population') original.population = invisible
    if (field === 'region') original.region = invisible
    if (field === 'baseline.provenanceNote') original.baseline.provenanceNote = invisible
    if (field === 'candidate.provenanceNote') original.candidate.provenanceNote = invisible
    assert.deepEqual(s, original)
  })
}

test('M3 QA safe control: readable accents, emoji, RTL and normal timestamps remain claimable', () => {
  const s = study()
  s.population = 'cafe\u0301 bezoekers 👩‍🍳'
  s.region = 'ليدن - Leiden'
  s.baseline.provenanceNote = '🛒 Handmatig gecontroleerd - café'
  s.candidate.provenanceNote = 'دوكان - notitie via handmatig mandje'
  const value = assessWeeklyBasketStudy(s)
  assert.equal(value.claimable, true)
  assert.equal(value.comparison.outcome, 'better')
  assert.equal(value.reasons.length, 0)
  assert.equal(value.observationWindowHours, 1)
})
