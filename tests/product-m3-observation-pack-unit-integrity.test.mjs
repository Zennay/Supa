import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  nextIncompleteObservationLine,
  observationLineCollectionComplete,
  observationSheetProgress,
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'

// Synthetic-only collector semantics; none of these values represent retailer evidence.
function completeSyntheticSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'test-valid-units-001',
    participantKey: 'test-user-pseudo',
    population: 'synthetic',
    region: 'test',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const side of ['baseline', 'candidate']) {
    const store = sheet[side]
    store.store = {
      id: side + '-test',
      name: side === 'baseline' ? 'PLUS Leiden' : 'DekaMarkt Leiden',
    }
    store.evidenceId = side + '-test-observation'
    store.observedAt = side === 'baseline'
      ? '2026-10-05T10:00:00Z'
      : '2026-10-05T11:00:00Z'
    store.provenanceNote = 'Synthetic regression input only'
    store.lines.forEach((line) => {
      line.observedProduct.available = false
    })
  }
  return sheet
}

test('an available M3 item requires a real recognized pack unit before collection-complete or export-ready', async (t) => {
  for (const side of ['baseline', 'candidate']) {
    for (const unit of ['bucket', 'litres', 'dozen', '', 'UNKNOWN', 500, {}, false, undefined]) {
      await t.test(side + ' / ' + String(unit), () => {
        const sheet = completeSyntheticSheet()
        const line = sheet[side].lines[0]
        Object.assign(line.observedProduct, {
          available: true,
          productName: 'Synthetic product',
          packAmount: 600,
          packCount: 1,
          priceCents: 199,
          packUnit: unit,
        })
        const before = structuredClone(sheet)
        assert.equal(observationLineCollectionComplete(line), false)
        const progress = observationSheetProgress(sheet)
        assert.equal(progress.completeLines, 21)
        const missing = nextIncompleteObservationLine(sheet)
        if (side === 'baseline') {
          assert.deepEqual(missing, { side, ingredientId: line.ingredientId })
        }
        const gate = observationSheetReadiness(sheet)
        assert.equal(gate.ready, false, side + ' / ' + String(unit))
        assert.match(gate.issues.join(' '), /eenheid|verpakking/i)
        assert.deepEqual(sheet, before, 'validation must not invent a legitimate unit')
      })
    }
  }
})

test('canonical supported M3 units preserve completion and readiness without changing units', () => {
  for (const unit of ['g', 'kg', 'ml', 'l', 'piece']) {
    const sheet = completeSyntheticSheet()
    const line = sheet.baseline.lines[0]
    Object.assign(line.observedProduct, {
      available: true,
      productName: 'Synthetic product',
      packAmount: 1,
      packCount: 1,
      priceCents: 199,
      packUnit: unit,
    })
    assert.equal(observationLineCollectionComplete(line), true)
    assert.equal(observationSheetProgress(sheet).completeLines, 22)
    assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
    assert.equal(line.observedProduct.packUnit, unit)
  }
})
