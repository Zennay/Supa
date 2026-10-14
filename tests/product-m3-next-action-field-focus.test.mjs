import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'
import {
  observationNextAction,
  observationNextTaskSelector,
} from '../src/features/observation/observationNextStep.ts'

function fillStudy(sheet) {
  Object.assign(sheet.study, {
    studyId: 'weekmeting-001', participantKey: 'anon-01',
    population: 'Uitwonende studenten', region: 'Leiden',
    weekStart: '2026-10-12', priceContext: 'in-store',
  })
}

test('fresh M3 collector focuses the exact current study field without changing sheet', () => {
  const sheet = buildObservationSheet()
  const before = structuredClone(sheet)
  const keys = ['studyId', 'participantKey', 'population', 'region', 'weekStart', 'priceContext']
  for (const key of keys) {
    const action = observationNextAction(sheet)
    assert.equal(action.stage, 'study', key)
    assert.equal(action.field, key)
    assert.equal(observationNextTaskSelector(action),
      '[data-observation-study-field="' + key + '"]')
    sheet.study[key] = key === 'priceContext' ? 'in-store' : 'anon-test'
  }
  assert.equal(before.study.studyId, '')
  sheet.study.priceContext = 'bad-context'
  assert.deepEqual(observationNextTaskSelector(observationNextAction(sheet)),
    '[data-observation-study-field="priceContext"]')
  assert.equal(sheet.study.priceContext, 'bad-context')
})

test('real PLUS/DekaMarkt task targets remain tied to their own store side', () => {
  const sheet = buildObservationSheet()
  fillStudy(sheet)
  for (const [side, retailer] of [['baseline', 'PLUS'], ['candidate', 'DekaMarkt']]) {
    if (side === 'candidate') {
      sheet.baseline.lines.forEach(line => { line.observedProduct.available = false })
    }
    const store = sheet[side]
    const fields = [
      ['name', () => { store.store.name = retailer + ' Leiden' }],
      ['id', () => { store.store.id = side + '-leiden' }],
      ['evidenceId', () => { store.evidenceId = side + '-001' }],
      ['observedAt', () => { store.observedAt = '2026-10-14T09:00:00Z' }],
      ['provenanceNote', () => { store.provenanceNote = 'Handmatig vastgelegd in winkel' }],
    ]
    for (const [field, fill] of fields) {
      const action = observationNextAction(sheet)
      assert.equal(action.stage, 'store', field)
      assert.equal(action.side, side)
      assert.equal(action.field, field)
      assert.equal(observationNextTaskSelector(action),
        '[data-observation-side="' + side + '"] [data-observation-store-field="' + field + '"]')
      fill()
    }
  }
  assert.equal(observationNextAction(sheet).stage, 'line')
})

test('invalid store date is navigable but review, line and export cannot spoof selectors', () => {
  const sheet = buildObservationSheet()
  fillStudy(sheet)
  Object.assign(sheet.baseline, {
    store: { id: 'plus-leiden', name: 'PLUS Leiden' },
    evidenceId: 'plus-proof',
    observedAt: 'not-a-date',
    provenanceNote: 'Bon',
  })
  const date = observationNextAction(sheet)
  assert.equal(date.field, 'observedAt')
  assert.match(observationNextTaskSelector(date), /data-observation-store-field="observedAt"/)
  for (const injected of [
    { stage: 'study', field: 'studyId"][autofocus="' },
    { stage: 'store', side: 'candidate"][hidden=', field: 'name' },
    { stage: 'store', side: 'baseline', field: '__proto__' },
    { stage: 'line', field: 'studyId' },
    { stage: 'review', field: 'studyId' },
    { stage: 'export', side: 'baseline', field: 'id' },
    {}, null,
  ]) assert.equal(observationNextTaskSelector(injected), null)
})

test('live collector registers all focusable fields and never opens data automatically', () => {
  const source = readFileSync(new URL('../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8')
  for (const field of ['studyId', 'participantKey', 'population', 'region', 'weekStart', 'priceContext']) {
    assert.match(source, new RegExp('data-observation-study-field="' + field + '"'))
  }
  for (const field of ['name', 'id', 'evidenceId', 'observedAt', 'provenanceNote']) {
    assert.match(source, new RegExp('data-observation-store-field="' + field + '"'))
  }
  assert.match(source, /observationNextTaskSelector\(nextAction\)/)
  assert.match(source, /document\.querySelector<HTMLInputElement \| HTMLSelectElement>\(nextTaskSelector\)/)
  assert.match(source, /onClick=\{jumpToNextIncomplete\}/)
  assert.match(source, /disabled=\{nextTaskSelector === null && !canJumpToNextLine\}/)
  assert.doesNotMatch(source, /autoFocus=|navigator\.clipboard|document\.execCommand/)
})
