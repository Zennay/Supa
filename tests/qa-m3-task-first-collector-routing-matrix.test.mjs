import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'
import { observationNextAction } from '../src/features/observation/observationNextStep.ts'

function filledSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-m3-study',
    participantKey: 'anonymous-synthetic',
    population: 'Example students',
    region: 'Controlled region',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const [side, retailer, at] of [
    ['baseline', 'PLUS', '2026-10-10T09:00:00Z'],
    ['candidate', 'DekaMarkt', '2026-10-10T10:00:00Z'],
  ]) {
    Object.assign(sheet[side], {
      evidenceId: `synthetic-${side}`,
      observedAt: at,
      provenanceNote: 'Controlled synthetic-only QA input; no observed store prices',
      store: { id: `synthetic-${side}-shop`, name: `${retailer} controlled demo` },
    })
    for (const line of sheet[side].lines) line.observedProduct.available = false
  }
  return sheet
}

test('121 incomplete PLUS × DekaMarkt line pairs always route baseline first, then candidate, then export', () => {
  const original = filledSheet()
  assert.equal(observationSheetReadiness(original).ready, true)
  assert.equal(observationNextAction(original).stage, 'export')
  let scenarios = 0

  for (let baselineIndex = 0; baselineIndex < original.baseline.lines.length; baselineIndex++) {
    for (let candidateIndex = 0; candidateIndex < original.candidate.lines.length; candidateIndex++) {
      const sheet = structuredClone(original)
      const baselineLine = sheet.baseline.lines[baselineIndex]
      const candidateLine = sheet.candidate.lines[candidateIndex]
      baselineLine.observedProduct.available = null
      candidateLine.observedProduct.available = null
      const originalSnapshot = JSON.stringify(sheet)

      const first = observationNextAction(sheet)
      assert.equal(first.stage, 'line')
      assert.equal(first.side, 'baseline')
      assert.equal(first.ingredientId, baselineLine.ingredientId)
      assert.equal(observationSheetReadiness(sheet).ready, false)
      assert.equal(JSON.stringify(sheet), originalSnapshot, 'guidance cannot mutate observation data')

      baselineLine.observedProduct.available = false
      const second = observationNextAction(sheet)
      assert.equal(second.stage, 'line')
      assert.equal(second.side, 'candidate')
      assert.equal(second.ingredientId, candidateLine.ingredientId)

      candidateLine.observedProduct.available = false
      const third = observationNextAction(sheet)
      assert.equal(third.stage, 'export')
      assert.match(third.detail, /nog geen besparing/i)
      assert.equal(observationSheetReadiness(sheet).ready, true)
      scenarios++
    }
  }
  assert.equal(scenarios, 11 * 11)
})

test('each of 22 single incomplete collection lines routes to its exact store and ingredient', () => {
  const original = filledSheet()
  let cases = 0
  for (const side of ['baseline', 'candidate']) {
    for (let i = 0; i < original[side].lines.length; i++) {
      const sheet = structuredClone(original)
      const line = sheet[side].lines[i]
      line.observedProduct.available = true
      const action = observationNextAction(sheet)
      assert.equal(action.stage, 'line')
      assert.equal(action.side, side)
      assert.equal(action.ingredientId, line.ingredientId)
      assert.match(action.detail, /vul niets op basis van een gok in/i)
      assert.equal(observationSheetReadiness(sheet).ready, false)
      cases++
    }
  }
  assert.equal(cases, 22)
})

test('exact 24-hour observation window is permitted; one second later requires genuine recollection', () => {
  const sheet = filledSheet()
  sheet.baseline.observedAt = '2026-10-09T10:00:00Z'
  sheet.candidate.observedAt = '2026-10-10T10:00:00Z'
  assert.equal(observationSheetReadiness(sheet).ready, true)
  assert.equal(observationNextAction(sheet).stage, 'export')

  sheet.candidate.observedAt = '2026-10-10T10:00:01Z'
  assert.equal(observationSheetReadiness(sheet).ready, false)
  const action = observationNextAction(sheet)
  assert.equal(action.stage, 'review')
  assert.match(action.title, /binnen 24 uur/)
  assert.match(action.detail, /nieuwe echte metingen/)
  assert.doesNotMatch(action.detail, /\d{4}-\d\d-\d\dT/)
})

test('personally identifying or internal diagnostic markers never leak into suggested next-step text', () => {
  const sentinel = 'private-participant-marker@example.invalid'
  const sheet = filledSheet()
  sheet.study.participantKey = sentinel
  sheet.study.region = sentinel
  sheet.baseline.provenanceNote = sentinel
  sheet.candidate.provenanceNote = sentinel
  sheet.baseline.evidenceId = sentinel

  const actions = [observationNextAction(sheet)]
  sheet.baseline.lines[0].observedProduct.available = null
  actions.push(observationNextAction(sheet))
  sheet.baseline.lines[0].observedProduct.available = false
  actions.push(observationNextAction(sheet))

  for (const action of actions) {
    const text = JSON.stringify(action)
    assert.doesNotMatch(text, /private-participant-marker|@example.invalid/i)
    assert.doesNotMatch(text, /assessment|converter|collection-template-not-evidence/i)
  }
})
