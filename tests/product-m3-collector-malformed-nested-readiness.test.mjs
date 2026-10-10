import assert from 'node:assert/strict'
import test from 'node:test'

import { buildObservationSheet, observationSheetReadiness } from '../src/domain/m3ObservationSheet.ts'

// Malformed draft/runtime data must not crash collection guidance or claim export.
function completeSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-runtime-001',
    participantKey: 'test-pseudo',
    population: 'synthetic',
    region: 'synthetic',
    weekStart: '2026-10-05',
    priceContext: 'online-order',
  })
  for (const side of ['baseline', 'candidate']) {
    const obs = sheet[side]
    obs.evidenceId = side + '-synthetic-evidence'
    obs.observedAt = side === 'baseline' ? '2026-10-05T09:00:00Z' : '2026-10-05T10:00:00Z'
    obs.source = 'receipt'
    obs.provenanceNote = 'Synthetic testing only'
    obs.store = { id: side + '-store', name: side === 'baseline' ? 'PLUS' : 'DekaMarkt' }
    obs.lines.forEach((line) => { line.observedProduct.available = false })
  }
  assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
  return sheet
}

test('M3 collection preflight recovers from malformed nested data with a review gate', async (t) => {
  const cases = [
    ['missing study', sheet => { sheet.study = null }],
    ['missing baseline', sheet => { sheet.baseline = null }],
    ['missing candidate', sheet => { sheet.candidate = null }],
    ['missing baseline store', sheet => { sheet.baseline.store = null }],
    ['candidate lines not an array', sheet => { sheet.candidate.lines = null }],
    ['missing baseline line', sheet => { sheet.baseline.lines[0] = null }],
    ['missing candidate product', sheet => { sheet.candidate.lines[0].observedProduct = null }],
    ['numeric store name', sheet => { sheet.baseline.store.name = 23 }],
    ['object provenance note', sheet => { sheet.candidate.provenanceNote = {} }],
    ['numeric available product name', sheet => {
      sheet.baseline.lines[0].observedProduct = {
        available: true, productName: 77, packAmount: 250, packUnit: 'g',
        packCount: 1, priceCents: 199, productId: '', sourceUrl: '', note: '',
      }
    }],
  ]
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const sheet = completeSheet()
      mutate(sheet)
      const snapshot = structuredClone(sheet)
      const result = observationSheetReadiness(sheet)
      assert.equal(result.ready, false)
      assert.ok(result.issues.length > 0, 'provide a recoverable problem')
      assert.deepEqual(sheet, snapshot, 'preflight must never rewrite the measurement')
    })
  }
})
