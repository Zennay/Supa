import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetProgress,
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'

// Independent QA contract for an untrusted in-memory collector state.
// All inputs are synthetic: no supermarket prices, participant identity or
// evidence supporting an M3 savings claim.
function filledProgressSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-study',
    participantKey: 'synthetic-pseudonym',
    population: 'synthetic',
    region: 'synthetic-region',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const side of ['baseline', 'candidate']) {
    const observation = sheet[side]
    observation.evidenceId = side + '-synthetic'
    observation.observedAt = '2026-10-05T10:00:00Z'
    observation.provenanceNote = 'Synthetic QA only'
    observation.store = {
      id: side + '-synthetic-id',
      name: side === 'baseline' ? 'PLUS' : 'DekaMarkt',
    }
    observation.lines.forEach(line => {
      line.observedProduct.available = false
    })
  }
  return sheet
}

test('M3 progress baseline counts exactly the valid synthetic fields', () => {
  const sheet = filledProgressSheet()
  assert.deepEqual(observationSheetReadiness(sheet), { ready: true, issues: [] })
  assert.deepEqual(observationSheetProgress(sheet), {
    totalLines: 22,
    availabilityRecorded: 22,
    completeLines: 22,
    metadataCompleted: 16,
    metadataTotal: 16,
  })
})

test('M3 progress handles non-string metadata as incomplete, not as a UI crash (issue #364)', async (t) => {
  const locations = [
    ['study.population', s => s.study, 'population'],
    ['study.region', s => s.study, 'region'],
    ['study.weekStart', s => s.study, 'weekStart'],
    ['baseline.store.name', s => s.baseline.store, 'name'],
    ['baseline.evidenceId', s => s.baseline, 'evidenceId'],
    ['candidate.store.id', s => s.candidate.store, 'id'],
    ['candidate.provenanceNote', s => s.candidate, 'provenanceNote'],
  ]
  const invalidValues = [null, 42, true, {}, []]
  for (const [label, select, key] of locations) {
    for (const invalid of invalidValues) {
      await t.test(label + ' = ' + JSON.stringify(invalid), () => {
        const sheet = filledProgressSheet()
        select(sheet)[key] = invalid
        const snapshot = structuredClone(sheet)
        const readiness = observationSheetReadiness(sheet)
        assert.equal(readiness.ready, false,
          'invalid metadata must not authorize a converter-ready collection')
        assert.ok(readiness.issues.length > 0)
        const progress = observationSheetProgress(sheet)
        assert.equal(progress.metadataTotal, 16)
        assert.equal(progress.metadataCompleted, 15,
          'a non-string field must not count as recorded evidence metadata')
        assert.equal(progress.completeLines, 22,
          'malformed display metadata must not rewrite recorded availability')
        assert.deepEqual(sheet, snapshot, 'rendering cannot mutate source data')
      })
    }
  }
})

test('M3 progress never treats a malformed measurement line as collected', async (t) => {
  const corruptions = [
    ['null baseline line', s => { s.baseline.lines[0] = null }],
    ['null candidate observed product', s => { s.candidate.lines[0].observedProduct = null }],
    ['missing baseline observed product', s => { delete s.baseline.lines[0].observedProduct }],
    ['non-object candidate observed product', s => { s.candidate.lines[0].observedProduct = 7 }],
  ]
  for (const [label, corrupt] of corruptions) {
    await t.test(label, () => {
      const sheet = filledProgressSheet()
      corrupt(sheet)
      const snapshot = structuredClone(sheet)
      const readiness = observationSheetReadiness(sheet)
      assert.equal(readiness.ready, false,
        'broken measurement containers must revoke export-ready')
      assert.ok(readiness.issues.length > 0)
      const progress = observationSheetProgress(sheet)
      assert.equal(progress.totalLines, 22)
      assert.ok(progress.completeLines < 22,
        'a corrupted line cannot be reported as fully collected')
      assert.ok(progress.availabilityRecorded < 22,
        'a corrupted line cannot count as observed availability')
      assert.deepEqual(sheet, snapshot)
    })
  }
})
