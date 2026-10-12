import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationLineCollectionComplete,
  observationSheetProgress,
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'

// Synthetic M2 collection sheet only. No observed prices, people, or retailer evidence.
const invisible = [
  ['zero-width', '\u200B'],
  ['word-joiner', '\u2060'],
  ['combining-mark', '\u0301'],
  ['mixed-format-mark', '\u200D\u034F\u0301'],
]

for (const [name, value] of invisible) {
  test(`M3 collector progress does not count ${name} as population evidence`, () => {
    const sheet = buildObservationSheet()
    sheet.study.population = value

    const progress = observationSheetProgress(sheet)
    assert.equal(progress.metadataCompleted, 0)
    assert.equal(progress.metadataTotal, 16)
  })

  test(`M3 collector readiness rejects ${name} as required region`, () => {
    const sheet = buildObservationSheet()
    sheet.study.region = value

    const result = observationSheetReadiness(sheet)
    assert.equal(result.ready, false)
    assert.ok(
      result.issues.includes('Regio ontbreekt.'),
      `Expected explicit region error, got: ${result.issues.join(' | ')}`,
    )
  })

  test(`M3 collector readiness rejects ${name} as provenance on both stores`, () => {
    const sheet = buildObservationSheet()
    sheet.baseline.provenanceNote = value
    sheet.candidate.provenanceNote = value

    const result = observationSheetReadiness(sheet)
    assert.equal(result.ready, false)
    assert.ok(result.issues.includes('Winkel A: provenance-notitie ontbreekt.'))
    assert.ok(result.issues.includes('Winkel B: provenance-notitie ontbreekt.'))
  })
}

test('M3 collector refuses an invisible-only measured product label', () => {
  const sheet = buildObservationSheet()
  const line = sheet.baseline.lines[0]
  line.observedProduct = {
    ...line.observedProduct,
    available: true,
    productName: '\u200B\u034F',
    packAmount: 500,
    packUnit: 'g',
    packCount: 1,
    priceCents: 250,
  }

  assert.equal(observationLineCollectionComplete(line), false)
})

test('M3 collector retains readable multilingual, emoji and decomposed-accent context', () => {
  const sheet = buildObservationSheet()
  sheet.study.population = 'Studenten in Leiden'
  sheet.study.region = 'ليدن / Leiden'
  sheet.baseline.provenanceNote = 'Winkelmand met café-notitie e\u0301 🌿'
  sheet.candidate.provenanceNote = '手動\u200D入力 - cart'

  const progress = observationSheetProgress(sheet)
  assert.equal(progress.metadataCompleted, 4)
  const readiness = observationSheetReadiness(sheet)
  assert.equal(readiness.ready, false) // Other mandatory fields and all 22 lines remain blank.
  assert.ok(!readiness.issues.includes('Populatie ontbreekt.'))
  assert.ok(!readiness.issues.includes('Regio ontbreekt.'))
  assert.ok(!readiness.issues.some((issue) => issue.includes('provenance-notitie ontbreekt.')))

  // A label with visible text remains complete for the same synthetic pack facts.
  const line = sheet.baseline.lines[0]
  line.observedProduct = {
    ...line.observedProduct,
    available: true,
    productName: 'Café e\u0301 🌿',
    packAmount: 500,
    packUnit: 'g',
    packCount: 1,
    priceCents: 250,
  }
  assert.equal(observationLineCollectionComplete(line), true)
})
