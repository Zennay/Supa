import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetProgress,
  observationSheetReadiness,
  observationWindowSummary,
  nextIncompleteObservationLine,
  observationSheetHasUserInput,
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

test('M3 progress treats malformed observation containers as an incomplete review state', async (t) => {
  const corruptions = [
    ['missing baseline lines', sheet => { sheet.baseline.lines = null }],
    ['candidate lines are an object', sheet => { sheet.candidate.lines = {} }],
    ['missing baseline store', sheet => { sheet.baseline.store = null }],
    ['missing candidate observation', sheet => { sheet.candidate = null }],
    ['missing study details', sheet => { sheet.study = null }],
  ]
  for (const [label, corrupt] of corruptions) {
    await t.test(label, () => {
      const sheet = filledProgressSheet()
      corrupt(sheet)
      const snapshot = structuredClone(sheet)
      const readiness = observationSheetReadiness(sheet)
      assert.equal(readiness.ready, false)
      assert.ok(readiness.issues.length > 0)
      const progress = observationSheetProgress(sheet)
      for (const key of ['totalLines', 'completeLines', 'availabilityRecorded',
        'metadataTotal', 'metadataCompleted']) {
        assert.ok(Number.isSafeInteger(progress[key]) && progress[key] >= 0,
          key + ': show finite nonnegative counters, never crash the UI')
      }
      assert.equal(progress.metadataTotal, 16)
      assert.ok(progress.metadataCompleted < 16 || progress.completeLines < 22,
        'malformed store/study/line container cannot look fully complete')
      assert.deepEqual(sheet, snapshot)
    })
  }
})

test('M3 task navigation does not crash after preflight refuses malformed rows (#1112)', async (t) => {
  const corruptions = [
    ['null baseline line', s => { s.baseline.lines[0] = null }],
    ['missing candidate product', s => { delete s.candidate.lines[0].observedProduct }],
    ['missing candidate lines', s => { s.candidate.lines = null }],
    ['missing baseline observation', s => { s.baseline = null }],
  ]
  for (const [label, corrupt] of corruptions) {
    await t.test(label, () => {
      const sheet = filledProgressSheet()
      corrupt(sheet)
      const snapshot = structuredClone(sheet)
      assert.equal(observationSheetReadiness(sheet).ready, false)
      const target = nextIncompleteObservationLine(sheet)
      assert.ok(target === null ||
        (['baseline', 'candidate'].includes(target.side) &&
          typeof target.ingredientId === 'string'),
      'malformed state may only produce a safe review target or no target')
      assert.deepEqual(sheet, snapshot)
    })
  }
})

test('M3 observation-window display stays fail-closed on missing observations (#1112)', async (t) => {
  const corruptions = [
    ['missing baseline observation', s => { s.baseline = null }],
    ['missing candidate observation', s => { s.candidate = null }],
    ['nonnumeric baseline observedAt', s => { s.baseline.observedAt = {} }],
    ['numeric candidate observedAt', s => { s.candidate.observedAt = 42 }],
  ]
  for (const [label, corrupt] of corruptions) {
    await t.test(label, () => {
      const sheet = filledProgressSheet()
      corrupt(sheet)
      const snapshot = structuredClone(sheet)
      assert.equal(observationSheetReadiness(sheet).ready, false)
      const summary = observationWindowSummary(sheet)
      assert.ok(['single-observation', 'not-started', 'outside-window'].includes(summary.state),
        'a missing or invalid timestamp cannot produce a valid two-store observation window')
      assert.deepEqual(sheet, snapshot)
    })
  }
})

test('M3 reset warning must not crash or disregard remaining user input (#1112)', async (t) => {
  const corruptions = [
    ['missing study', s => { s.study = null }],
    ['missing baseline', s => { s.baseline = null }],
    ['missing candidate store', s => { s.candidate.store = null }],
    ['null candidate line', s => { s.candidate.lines[0] = null }],
    ['missing baseline product', s => { s.baseline.lines[0].observedProduct = null }],
  ]
  for (const [label, corrupt] of corruptions) {
    await t.test(label, () => {
      const sheet = filledProgressSheet()
      corrupt(sheet)
      const snapshot = structuredClone(sheet)
      assert.equal(observationSheetReadiness(sheet).ready, false)
      assert.equal(observationSheetHasUserInput(sheet), true,
        'destructive-action confirmation cannot silently drop remaining user edits')
      assert.deepEqual(sheet, snapshot)
    })
  }
})
