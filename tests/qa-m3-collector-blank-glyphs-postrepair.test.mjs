import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationLineCollectionComplete,
  observationSheetProgress,
  observationSheetReadiness,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

// Independent synthetic replay on exact-head blank-glyph source repair:
// array of codepoint mixes different from upstream expected-RED probes.
const blankSequences = [
  ['Hangul pair', '\u115F\u1160'],
  ['Braille and a mark', '\u2800\u0301'],
  ['halfwidth and joining control', '\uFFA0\u200D'],
  ['ASCII whitespace and fillers', ' \u3164\u2800\t'],
  ['combination of all five fillers', '\u115F\u1160\u3164\uFFA0\u2800'],
]

for (const [name, candidate] of blankSequences) {
  test(`restored M3 observation ${name}: metadata remains incomplete`, () => {
    const sheet = buildObservationSheet()
    sheet.study.population = candidate
    sheet.study.region = candidate
    sheet.baseline.provenanceNote = candidate
    sheet.candidate.provenanceNote = candidate

    const original = JSON.stringify(sheet)
    const restored = restoreObservationSheetDraft(original)
    assert.ok(restored)
    assert.equal(observationSheetProgress(restored).metadataCompleted, 0)
    const readiness = observationSheetReadiness(restored)
    assert.equal(readiness.ready, false)
    for (const expected of [
      'Populatie ontbreekt.',
      'Regio ontbreekt.',
      'Winkel A: provenance-notitie ontbreekt.',
      'Winkel B: provenance-notitie ontbreekt.',
    ]) {
      assert.ok(readiness.issues.includes(expected), expected)
    }
    assert.equal(JSON.stringify(sheet), original)
  })

  test(`restored M3 observation ${name}: unlabelled product remains incomplete`, () => {
    const sheet = buildObservationSheet()
    const first = sheet.baseline.lines[0]
    first.observedProduct = {
      ...first.observedProduct,
      productName: candidate,
      available: true,
      packAmount: 2,
      packUnit: 'piece',
      packCount: 1,
      priceCents: 125,
    }
    const serialized = JSON.stringify(sheet)
    const restored = restoreObservationSheetDraft(serialized)
    assert.ok(restored)
    assert.equal(observationLineCollectionComplete(restored.baseline.lines[0]), false)
    assert.equal(JSON.stringify(sheet), serialized)
  })
}

test('legible Hangul and inked Braille with format/marks survive round-trip', () => {
  const sheet = buildObservationSheet()
  sheet.study.population = '학생들 / studenten'
  sheet.study.region = '\u115F서울 / Haarlem'
  sheet.baseline.provenanceNote = '\u2800 ⠛⠕⠑⠙'
  sheet.candidate.provenanceNote = 'Bon e\u0301 123'
  const line = sheet.baseline.lines[0]
  line.observedProduct = {
    ...line.observedProduct,
    productName: '한글 \u3164 ⠇⠑⠑⠎',
    available: true,
    packAmount: 1,
    packUnit: 'piece',
    packCount: 1,
    priceCents: 125,
  }
  const restored = restoreObservationSheetDraft(JSON.stringify(sheet))
  assert.ok(restored)
  assert.equal(observationSheetProgress(restored).metadataCompleted, 4)
  assert.equal(observationLineCollectionComplete(restored.baseline.lines[0]), true)
  const validation = observationSheetReadiness(restored)
  assert.ok(!validation.issues.includes('Populatie ontbreekt.'))
  assert.ok(!validation.issues.includes('Regio ontbreekt.'))
  assert.ok(!validation.issues.some((reason) => reason.includes('provenance-notitie ontbreekt.')))
})
