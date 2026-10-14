import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationLineCollectionComplete,
  observationSheetProgress,
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'

// Synthetic-only follow-up to the frozen Unicode-visible collector fix.
// These five codepoints render without readable ink in common fonts but are
// Unicode letters/symbols rather than marks, controls, formats, or whitespace.
const blankGlyphs = [
  ['Hangul choseong filler', '\u115F'],
  ['Hangul jungseong filler', '\u1160'],
  ['Hangul filler', '\u3164'],
  ['halfwidth Hangul filler', '\uFFA0'],
  ['Braille pattern blank', '\u2800'],
]

for (const [name, glyph] of blankGlyphs) {
  test(`M3 progress must not count visually empty ${name} as region`, () => {
    const sheet = buildObservationSheet()
    sheet.study.region = glyph

    assert.equal(observationSheetProgress(sheet).metadataCompleted, 0)
  })

  test(`M3 readiness must report visually empty ${name} provenance`, () => {
    const sheet = buildObservationSheet()
    sheet.baseline.provenanceNote = glyph
    sheet.candidate.provenanceNote = glyph

    const actual = observationSheetReadiness(sheet)
    assert.equal(actual.ready, false)
    assert.ok(actual.issues.includes('Winkel A: provenance-notitie ontbreekt.'))
    assert.ok(actual.issues.includes('Winkel B: provenance-notitie ontbreekt.'))
  })

  test(`M3 physical product row must not accept ${name} as its name`, () => {
    const sheet = buildObservationSheet()
    const line = sheet.baseline.lines[0]
    line.observedProduct = {
      ...line.observedProduct,
      available: true,
      productName: glyph,
      packAmount: 500,
      packUnit: 'g',
      packCount: 1,
      priceCents: 100,
    }

    assert.equal(observationLineCollectionComplete(line), false)
  })
}

test('M3 collector still accepts actual Hangul and nonblank Braille symbols', () => {
  const sheet = buildObservationSheet()
  sheet.study.region = '서울'
  sheet.baseline.provenanceNote = '⠁⠃ veldnotitie'
  sheet.candidate.provenanceNote = 'Echte observatienotitie'
  assert.equal(observationSheetProgress(sheet).metadataCompleted, 3)
  const readiness = observationSheetReadiness(sheet)
  assert.ok(!readiness.issues.includes('Regio ontbreekt.'))
  assert.ok(!readiness.issues.some((reason) => reason.includes('provenance-notitie ontbreekt.')))
  const line = sheet.baseline.lines[0]
  line.observedProduct = {
    ...line.observedProduct,
    available: true,
    productName: '한글 ⠁⠃',
    packAmount: 500,
    packUnit: 'g',
    packCount: 1,
    priceCents: 100,
  }
  assert.equal(observationLineCollectionComplete(line), true)
})
