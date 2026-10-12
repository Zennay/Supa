import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import { buildObservedWeekReport } from '../scripts/m3-assess-observed-week.mjs'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// Separate M2-generated synthetic basket, no real price, participant or receipt.
function basket(storeId, adjustment) {
  const products = m2Products.map((p) => ({
    ...p, id: storeId + '-' + p.id, storeId,
    priceCents: p.priceCents + adjustment,
  }))
  products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', available: true,
    priceCents: 139 + adjustment,
  })
  return buildOneStoreBasket({
    store: { id: storeId, name: storeId === 'qa-glyph-store-a' ? 'PLUS fictief' : 'DekaMarkt fictief' },
    products, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
  })
}

function study() {
  return {
    schemaVersion: 1,
    studyId: 'qa-m3-blank-glyph-acceptance-2026',
    participantKey: 'fictional-student-protected-001',
    population: 'students', region: 'Leiden',
    weekStart: '2026-10-05', priceContext: 'in-store',
    baseline: {
      evidenceId: 'qa-glyph-c1', observedAt: '2026-10-05T11:00:00Z',
      source: 'manual-cart', provenanceNote: 'Mock A',
      basket: basket('qa-glyph-store-a', 0),
    },
    candidate: {
      evidenceId: 'qa-glyph-c2', observedAt: '2026-10-05T12:00:00Z',
      source: 'manual-cart', provenanceNote: 'Mock B',
      basket: basket('qa-glyph-store-b', -10),
    },
  }
}

for (const [field, invisible] of [
  ['population', '\u115F\u1160\u2800'],
  ['region', '\u3164\u034F'],
  ['baseline', '\uFFA0\u200D'],
  ['candidate', '\u2800\u3164\u0301'],
  ['population', '\t\u2800 \u115F'],
  ['region', '\u2060\u1160\uFFA0'],
]) {
  test('M3 report and savings assessment abstain on all-blank ' + field, () => {
    const raw = study()
    if (field === 'baseline' || field === 'candidate') raw[field].provenanceNote = invisible
    else raw[field] = invisible
    const saved = JSON.stringify(raw)
    const restored = JSON.parse(saved)
    const assessment = assessWeeklyBasketStudy(restored)
    assert.equal(assessment.claimable, false)
    assert.equal(assessment.comparison.outcome, 'unknown')
    assert.equal(assessment.comparison.deltaCents, null)
    assert.equal(assessment.comparison.savingsCents, null)
    assert.deepEqual(assessment.comparison.lineDeltas, [])
    const report = buildObservedWeekReport(restored)
    assert.equal(report.claimable, false)
    assert.equal(report.outcome, 'unknown')
    assert.equal(report.deltaCents, null)
    assert.equal(report.savingsCents, null)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(Object.hasOwn(report, 'participantKey'), false)
    assert.equal(JSON.stringify(restored), saved)
  })
}

test('M3 report allows visible Hangul/Braille mixed with blank fillers but stays private', () => {
  const s = study()
  s.region = '\u115F서울'
  s.population = '⠇⠑⠑⠎ students'
  s.baseline.provenanceNote = 'Echt leesbaar \u2800 bonnetje'
  s.candidate.provenanceNote = 'Student caf' + 'e\u0301'
  const before = JSON.stringify(s)
  const actual = assessWeeklyBasketStudy(s)
  const report = buildObservedWeekReport(s)
  assert.equal(actual.claimable, true)
  assert.equal(actual.comparison.outcome, 'better')
  assert.equal(report.claimable, true)
  assert.equal(report.outcome, 'better')
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(Object.hasOwn(report, 'participantKey'), false)
  assert.equal(JSON.stringify(s), before)
})
