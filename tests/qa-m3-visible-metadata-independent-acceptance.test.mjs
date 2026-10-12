import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// Fully synthetic: this never reads or writes a real M3 observation.
function basket(store, priceAdjustment = 0) {
  const products = m2Products.map(p => ({
    ...p, id: store.id + '-' + p.id, storeId: store.id,
    priceCents: p.priceCents + priceAdjustment,
  }))
  products.push({
    id: store.id + '-garam',
    storeId: store.id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', available: true,
    priceCents: 139 + priceAdjustment,
  })
  return buildOneStoreBasket({
    store, plan: m2InitialPlan, recipes: m2Recipes,
    products, activeDays: m2DefaultActiveDays,
  })
}

function study() {
  return {
    schemaVersion: 1, studyId: 'qa-visible-fields-2026',
    participantKey: 'student-pseudonym-test', population: 'studenten',
    region: 'Leiden', weekStart: '2026-10-05', priceContext: 'in-store',
    baseline: {
      evidenceId: 'qa-plus-001', observedAt: '2026-10-05T10:00:00Z',
      source: 'manual-cart', provenanceNote: 'Synthetic observation notes.',
      basket: basket({ id: 'plus-qa', name: 'PLUS fictief' }),
    },
    candidate: {
      evidenceId: 'qa-deka-001', observedAt: '2026-10-05T11:00:00Z',
      source: 'manual-cart', provenanceNote: 'Synthetic comparison notes.',
      basket: basket({ id: 'dekamarkt-qa', name: 'DekaMarkt fictief' }, -10),
    },
  }
}

function mutate(subject, field, value) {
  if (field === 'population' || field === 'region') subject[field] = value
  else if (field === 'baseline') subject.baseline.provenanceNote = value
  else subject.candidate.provenanceNote = value
}

for (const [field, label, invisible] of [
  ['region', 'C0 control', '\u0007'],
  ['region', 'only variation selector 16', '\uFE0F'],
  ['population', 'bidi directional mark', '\u200E'],
  ['population', 'lone low surrogate', '\uDC00'],
  ['baseline', 'invisible format plus mark', '\u2060\u0301'],
  ['baseline', 'mixed controls and format', '\u0001\u200B'],
  ['candidate', 'lone high surrogate', '\uD800'],
  ['candidate', 'format and combining grapheme', '\u200D\u034F'],
]) {
  test('M3 independent invisible metadata acceptance: ' + field + ' ' + label, () => {
    const s = study()
    mutate(s, field, invisible)
    const before = structuredClone(s)
    const check = assessWeeklyBasketStudy(s)
    assert.equal(check.claimable, false)
    assert.equal(check.comparison.outcome, 'unknown')
    assert.equal(check.comparison.deltaCents, null)
    assert.equal(check.comparison.savingsCents, null)
    assert.deepEqual(check.comparison.lineDeltas, [])
    const report = buildObservedWeekReport(s)
    assert.equal(report.claimable, false)
    assert.equal(report.outcome, 'unknown')
    assert.equal(report.deltaCents, null)
    assert.equal(report.savingsCents, null)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal('participantKey' in report, false)
    assert.deepEqual(s, before)
  })
}

test('M3 independent: visible text with combining accents, RTL scripts and emoji stays accepted', () => {
  const s = study()
  s.region = 'Léiden 🥦'
  s.population = 'cafe\u0301 studenten'
  s.baseline.provenanceNote = 'متجر - checked by tester'
  s.candidate.provenanceNote = '👩‍🍳 getoetste fictieve prijzen'
  const check = assessWeeklyBasketStudy(s)
  const report = buildObservedWeekReport(s)
  assert.equal(check.claimable, true)
  assert.equal(check.comparison.outcome, 'better')
  assert.equal(report.claimable, true)
  assert.equal(report.outcome, 'better')
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal('participantKey' in report, false)
})
