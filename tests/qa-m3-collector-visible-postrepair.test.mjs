import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  nextIncompleteObservationLine,
  observationLineCollectionComplete,
  observationSheetProgress,
  observationSheetReadiness,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

// Independent postrepair acceptance. All 22 planned demands remain M2 fixtures,
// with no real retailer, participant, price, or savings evidence.
const blankOnly = [
  ['directional-mark', '\u200E'],
  ['right-to-left-override', '\u202E'],
  ['variation-selector', '\uFE0F'],
  ['control', '\u0007'],
  ['lone-high-surrogate', '\uD800'],
  ['lone-low-surrogate', '\uDC00'],
  ['format-and-mark', '\u2063\u0308\u200D'],
]

for (const [name, blank] of blankOnly) {
  test(`restored M3 sheet: ${name} cannot complete visible metadata`, () => {
    const sheet = buildObservationSheet()
    sheet.study.region = blank
    sheet.baseline.provenanceNote = blank
    sheet.candidate.provenanceNote = blank
    const sourceBefore = JSON.stringify(sheet)
    const restored = restoreObservationSheetDraft(sourceBefore)
    assert.ok(restored, 'Canonical, JSON-serialized draft must be recoverable')
    const progress = observationSheetProgress(restored)
    assert.equal(progress.metadataCompleted, 0)
    assert.equal(progress.metadataTotal, 16)
    const readiness = observationSheetReadiness(restored)
    assert.equal(readiness.ready, false)
    assert.ok(readiness.issues.includes('Regio ontbreekt.'))
    assert.ok(readiness.issues.includes('Winkel A: provenance-notitie ontbreekt.'))
    assert.ok(readiness.issues.includes('Winkel B: provenance-notitie ontbreekt.'))
    assert.equal(JSON.stringify(sheet), sourceBefore, 'Input must not mutate')
  })

  test(`M3 product row: ${name} cannot become a complete physical observation`, () => {
    const sheet = buildObservationSheet()
    const first = sheet.baseline.lines[0]
    first.observedProduct = {
      ...first.observedProduct,
      productName: blank,
      available: true,
      packAmount: 500,
      packUnit: 'g',
      packCount: 1,
      priceCents: 199,
    }
    const before = JSON.stringify(sheet)
    assert.equal(observationLineCollectionComplete(first), false)
    assert.deepEqual(nextIncompleteObservationLine(sheet), {
      side: 'baseline',
      ingredientId: first.ingredientId,
    })
    assert.equal(JSON.stringify(sheet), before, 'Availability/price facts must not mutate')
  })
}

test('real Dutch, Arabic, Hangul, joined emoji, and decomposed text remain counted', () => {
  const sheet = buildObservationSheet()
  sheet.study.population = 'Uitwonende studenten'
  sheet.study.region = 'القاهرة / 서울'
  sheet.baseline.provenanceNote = 'Bon in café e\u0301'
  sheet.candidate.provenanceNote = 'Observatie 👩\u200D🍳'
  assert.equal(observationSheetProgress(sheet).metadataCompleted, 4)
  const readiness = observationSheetReadiness(sheet)
  assert.ok(!readiness.issues.includes('Populatie ontbreekt.'))
  assert.ok(!readiness.issues.includes('Regio ontbreekt.'))
  assert.ok(!readiness.issues.some((reason) => reason.includes('provenance-notitie ontbreekt.')))

  const first = sheet.baseline.lines[0]
  first.observedProduct = {
    ...first.observedProduct,
    available: true,
    productName: 'Rijst 👩\u200D🍳',
    packAmount: 500,
    packUnit: 'g',
    packCount: 1,
    priceCents: 199,
  }
  assert.equal(observationLineCollectionComplete(first), true)
})
