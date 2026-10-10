import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'
import { observationNextAction } from '../src/features/observation/observationNextStep.ts'

function fillStudy(sheet) {
  Object.assign(sheet.study, {
    studyId: 'study-controlled',
    participantKey: 'anon-001',
    population: 'Uitwonende studenten',
    region: 'Leiden',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
}

function fillStore(sheet, side, observedAt) {
  const retailer = side === 'baseline' ? 'PLUS' : 'DekaMarkt'
  Object.assign(sheet[side], {
    evidenceId: side + '-evidence',
    observedAt,
    provenanceNote: 'Handmatige winkelmand in dezelfde prijscontext',
    store: {
      id: side + '-leiden',
      name: retailer + ' Leiden',
    },
  })
}

function fillAllUnavailable(sheet) {
  for (const side of ['baseline', 'candidate']) {
    sheet[side].lines.forEach((line) => {
      line.observedProduct.available = false
    })
  }
}

test('M3 task guidance starts with personal-data-safe study setup, not raw validation counts', () => {
  const sheet = buildObservationSheet()
  const first = observationNextAction(sheet)
  assert.deepEqual(first, {
    stage: 'study',
    title: 'Geef deze meting een code',
    detail: 'Kies een herkenbare code voor deze winkelvergelijking.',
  })

  sheet.study.studyId = 'test'
  const next = observationNextAction(sheet)
  assert.equal(next.stage, 'study')
  assert.match(next.title, /anonieme deelnemerscode/)
  assert.match(next.detail, /geen naam, e-mailadres/)
})

test('M3 guidance walks through exact PLUS then DekaMarkt collection tasks', () => {
  const sheet = buildObservationSheet()
  fillStudy(sheet)

  assert.deepEqual(observationNextAction(sheet), {
    stage: 'store',
    side: 'baseline',
    title: 'Controleer de winkelnaam van PLUS',
    detail:
      'Vul de echte PLUS-vestiging in. Een andere supermarkt hoort niet bij deze vergelijking.',
  })

  fillStore(sheet, 'baseline', '2026-10-10T09:00:00Z')
  const plusLine = observationNextAction(sheet)
  assert.equal(plusLine.stage, 'line')
  assert.equal(plusLine.side, 'baseline')
  assert.equal(plusLine.ingredientId, sheet.baseline.lines[0].ingredientId)
  assert.match(plusLine.title, /PLUS.*Basmati rijst/)

  sheet.baseline.lines.forEach((line) => {
    line.observedProduct.available = false
  })

  const dekaStore = observationNextAction(sheet)
  assert.equal(dekaStore.stage, 'store')
  assert.equal(dekaStore.side, 'candidate')
  assert.match(dekaStore.title, /DekaMarkt/)

  fillStore(sheet, 'candidate', '2026-10-10T10:00:00Z')
  const dekaLine = observationNextAction(sheet)
  assert.equal(dekaLine.stage, 'line')
  assert.equal(dekaLine.side, 'candidate')
  assert.match(dekaLine.title, /DekaMarkt.*Basmati rijst/)
})

test('M3 complete forms instruct export for separate review, never assert proven savings', () => {
  const sheet = buildObservationSheet()
  fillStudy(sheet)
  fillStore(sheet, 'baseline', '2026-10-10T09:00:00Z')
  fillStore(sheet, 'candidate', '2026-10-10T10:00:00Z')
  fillAllUnavailable(sheet)

  assert.equal(observationSheetReadiness(sheet).ready, true)
  const action = observationNextAction(sheet)
  assert.equal(action.stage, 'export')
  assert.match(action.detail, /concept.*controle en beoordeling/)
  assert.match(action.detail, /nog geen besparing/)
})

test('M3 guidance refuses to label invalid outside-window evidence ready', () => {
  const sheet = buildObservationSheet()
  fillStudy(sheet)
  fillStore(sheet, 'baseline', '2026-10-08T09:00:00Z')
  fillStore(sheet, 'candidate', '2026-10-10T10:00:00Z')
  fillAllUnavailable(sheet)

  assert.equal(observationSheetReadiness(sheet).ready, false)
  assert.equal(observationNextAction(sheet).stage, 'review')
})

test('M3 partially filled matched product is still a collection task', () => {
  const sheet = buildObservationSheet()
  fillStudy(sheet)
  fillStore(sheet, 'baseline', '2026-10-10T09:00:00Z')
  sheet.baseline.lines[0].observedProduct.available = true

  const action = observationNextAction(sheet)
  assert.equal(action.stage, 'line')
  assert.equal(action.ingredientId, sheet.baseline.lines[0].ingredientId)
  assert.match(action.detail, /Laat onbekende gegevens open/)
})

test('M3 malformed inputs fail closed and task guidance does not mutate collected sheet', () => {
  for (const malformed of [null, [], {}, { study: null }, { baseline: null }]) {
    const action = observationNextAction(malformed)
    assert.equal(action.stage, 'review')
  }

  const sheet = buildObservationSheet()
  fillStudy(sheet)
  const before = JSON.stringify(sheet)
  const first = observationNextAction(sheet)
  const second = observationNextAction(sheet)
  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(sheet), before)
})

test('M3 visible guidance avoids internal evidence vocabulary and raw issue counts', () => {
  const sheet = buildObservationSheet()
  const variants = [observationNextAction(sheet)]
  fillStudy(sheet)
  variants.push(observationNextAction(sheet))
  fillStore(sheet, 'baseline', '2026-10-10T09:00:00Z')
  variants.push(observationNextAction(sheet))
  fillAllUnavailable(sheet)
  variants.push(observationNextAction(sheet))
  fillStore(sheet, 'candidate', '2026-10-10T10:00:00Z')
  variants.push(observationNextAction(sheet))

  for (const action of variants) {
    assert.doesNotMatch(
      action.title + ' ' + action.detail,
      /M3|Preflight|converter|assessment|Study ID|Participant key|collection-template-not-evidence|\\d+ controles open/i,
    )
  }
})
