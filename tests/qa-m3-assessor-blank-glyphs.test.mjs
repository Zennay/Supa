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

function syntheticBasket(storeId, delta) {
  return buildOneStoreBasket({
    store: { id: storeId, name: storeId === 'store-a' ? 'Synthetic store A' : 'Synthetic store B' },
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: [
      ...m2Products.map((p) => ({
        ...p, id: storeId + '-' + p.id, storeId, priceCents: p.priceCents + delta,
      })),
      {
        id: storeId + '-garam-50', storeId, name: 'Garam masala 50 g',
        packAmount: 50, packUnit: 'g', available: true, priceCents: 139 + delta,
      },
    ],
  })
}

function syntheticStudy() {
  return {
    schemaVersion: 1,
    studyId: 'week-2026-40-glyph-check',
    participantKey: 'student-fictitious-glyph-check',
    population: 'independently living students',
    region: 'Leiden',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'synthetic-glyph-a',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Controlled basket A',
      basket: syntheticBasket('store-a', 0),
    },
    candidate: {
      evidenceId: 'synthetic-glyph-b',
      observedAt: '2026-10-02T18:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Controlled basket B',
      basket: syntheticBasket('store-b', -10),
    },
  }
}

const blankGlyphs = [
  ['Hangul choseong filler', '\u115F'],
  ['Hangul jungseong filler', '\u1160'],
  ['Hangul filler', '\u3164'],
  ['halfwidth Hangul filler', '\uFFA0'],
  ['Braille pattern blank', '\u2800'],
]

for (const [name, invisible] of blankGlyphs) {
  for (const [path, reason] of [
    ['population', /population is required/],
    ['region', /region is required/],
    ['baseline.provenanceNote', /baseline evidence provenance note is required/],
    ['candidate.provenanceNote', /candidate evidence provenance note is required/],
  ]) {
    test(`M3 assessment refuses ${name} as ${path}`, () => {
      const study = syntheticStudy()
      const parent = path.startsWith('baseline.') ? study.baseline :
        path.startsWith('candidate.') ? study.candidate : study
      parent[path.split('.').at(-1)] = invisible
      const before = JSON.stringify(study)

      const result = assessWeeklyBasketStudy(study)
      assert.equal(result.claimable, false)
      assert.equal(result.comparison.claimable, false)
      assert.equal(result.comparison.outcome, 'unknown')
      assert.equal(result.comparison.deltaCents, null)
      assert.equal(result.comparison.savingsCents, null)
      assert.deepEqual(result.comparison.lineDeltas, [])
      assert.match(result.reasons.join(' '), reason)
      assert.equal(JSON.stringify(study), before)
    })
  }
}

test('M3 assessment accepts visible Hangul, Braille, emoji and decomposed notes', () => {
  const study = syntheticStudy()
  study.population = '한글 students'
  study.region = '⠁⠃ Leiden'
  study.baseline.provenanceNote = 'Nota e\u0301'
  study.candidate.provenanceNote = '👩\u200D🍳 手動 123'
  const result = assessWeeklyBasketStudy(study)
  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
  assert.equal(result.observationWindowHours, 1)
  assert.ok(result.comparison.savingsCents > 0)
})
