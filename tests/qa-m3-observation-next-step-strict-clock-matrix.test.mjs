import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
  observationWindowSummary,
  validObservedAt,
} from '../src/domain/m3ObservationSheet.ts'
import {
  observationNextAction,
  observationNextTaskSelector,
} from '../src/features/observation/observationNextStep.ts'

// QA-only independent replay against the product owner's M3 timestamp repair.
// The 11 + 11 item states are synthetic and unavailable: no real measurements,
// retailer access, savings conclusions, or release eligibility.
function readySheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-clock-only',
    participantKey: 'synthetic-anonymous',
    population: 'fictieve uitwonende studenten',
    region: 'fictieve regio',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const [side, name, time] of [
    ['baseline', 'PLUS fictief', '2026-10-10T09:00:00Z'],
    ['candidate', 'DekaMarkt fictief', '2026-10-10T10:00:00Z'],
  ]) {
    Object.assign(sheet[side], {
      evidenceId: 'qa-' + side,
      observedAt: time,
      provenanceNote: 'Uitsluitend gesimuleerd, geen winkelbewijs',
      source: 'manual-cart',
      store: { id: 'qa-' + side, name },
    })
    for (const row of sheet[side].lines) row.observedProduct.available = false
  }
  assert.equal(sheet.baseline.lines.length + sheet.candidate.lines.length, 22)
  assert.equal(observationSheetReadiness(sheet).ready, true)
  return sheet
}

const INVALID = [
  '2026-10-10',
  '2026-10-10T09:00:00',
  '2026-10-10T09:00:00+0200',
  '2026-10-10T09:00:00+02',
  '2026-02-29T09:00:00Z',
  '2026-04-31T09:00:00Z',
  '2026-10-10T24:00:00Z',
  '2026-10-10T09:60:00Z',
  '2026-10-10T09:00:60Z',
  '2026-10-10T09:00:00+24:00',
  '2026-10-10T09:00:00+23:60',
  'Sat, 10 Oct 2026 09:00:00 GMT',
]

test('QA real next-step guidance and canonical readiness reject identical invalid clock grammar on BOTH retailers', () => {
  for (const side of ['baseline', 'candidate']) {
    for (const invalid of INVALID) {
      const sheet = readySheet()
      sheet[side].observedAt = invalid
      const original = JSON.stringify(sheet)
      const action = observationNextAction(sheet)
      const readiness = observationSheetReadiness(sheet)
      assert.equal(validObservedAt(invalid), null, side + ' ' + invalid)
      assert.equal(readiness.ready, false, side + ' ' + invalid)
      assert.ok(readiness.issues.some(x => x.includes('geldige observatietijd')),
        'canonical readiness must identify invalid clock')
      assert.deepEqual(
        { stage: action.stage, side: action.side, field: action.field },
        { stage: 'store', side, field: 'observedAt' },
        'guide must point to the invalid retailer field, never next product/review/export',
      )
      assert.equal(
        observationNextTaskSelector(action),
        '[data-observation-side="' + side + '"] [data-observation-store-field="observedAt"]',
      )
      assert.match(action.detail, /Vul geen geschatte tijd in/)
      assert.notEqual(observationWindowSummary(sheet).state, 'within-window')
      assert.doesNotMatch(action.title + action.detail, /besparing bewezen|publiceer/i)
      assert.equal(JSON.stringify(sheet), original, 'guidance cannot edit field evidence')
    }
  }
})

test('QA canonical timezone-qualified UTC and DST offsets keep correct task progression on both sides', () => {
  for (const [baseline, candidate] of [
    ['2026-10-10T09:00:00Z', '2026-10-10T10:00:00+01:00'],
    ['2026-10-10T09:00:00+02:00', '2026-10-10T10:00:00+01:00'],
    ['2026-10-10T09:00:00-05:00', '2026-10-10T14:30:00Z'],
    ['2026-10-10T09:00:00.123Z', '2026-10-10T09:30:00.123Z'],
  ]) {
    const sheet = readySheet()
    sheet.baseline.observedAt = baseline
    sheet.candidate.observedAt = candidate
    const before = JSON.stringify(sheet)
    assert.ok(Number.isFinite(validObservedAt(baseline)))
    assert.ok(Number.isFinite(validObservedAt(candidate)))
    assert.equal(observationSheetReadiness(sheet).ready, true)
    assert.equal(observationWindowSummary(sheet).state, 'within-window')
    const action = observationNextAction(sheet)
    assert.equal(action.stage, 'export', 'valid clocks may proceed to local draft export')
    assert.match(action.detail, /nog geen besparing/)
    assert.equal(observationNextTaskSelector(action), null,
      'export stage cannot fake a field selector or submit data')
    assert.equal(JSON.stringify(sheet), before)
  }
})

test('QA stale outside-24-hour genuine-looking times point to recollection, not a claim', () => {
  const sheet = readySheet()
  sheet.baseline.observedAt = '2026-10-07T09:00:00Z'
  sheet.candidate.observedAt = '2026-10-10T10:00:00Z'
  const action = observationNextAction(sheet)
  assert.equal(action.stage, 'review')
  assert.match(action.title, /Meet beide winkels binnen 24 uur/)
  assert.match(action.detail, /pas de tijden niet kunstmatig aan/)
  assert.equal(observationSheetReadiness(sheet).ready, false)
  assert.equal(observationNextTaskSelector(action), null)
})
