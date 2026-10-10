import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildObservationSheet,
  nextIncompleteObservationLine,
  observationSheetHasUserInput,
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'

// Independent synthetic QA cases for in-memory/JSON-damaged collector state.
// No participant, retailer observation, permission, prices or savings evidence.
function syntheticCompleteSheet() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-m3-study',
    participantKey: 'synthetic-subject',
    population: 'synthetic-population',
    region: 'synthetic-region',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const side of ['baseline', 'candidate']) {
    const observation = sheet[side]
    observation.evidenceId = side + '-synthetic-evidence'
    observation.observedAt = '2026-10-05T10:00:00Z'
    observation.provenanceNote = 'synthetic QA only'
    observation.store = {
      id: side + '-synthetic-store',
      name: side === 'baseline' ? 'PLUS' : 'DekaMarkt',
    }
    for (const line of observation.lines) line.observedProduct.available = false
  }
  return sheet
}

test('M3 reset confirmation: pristine draft is safe, valid user entry is protected', () => {
  const pristine = buildObservationSheet()
  const unchanged = structuredClone(pristine)
  assert.equal(observationSheetHasUserInput(pristine), false)
  assert.deepEqual(pristine, unchanged)

  const entered = buildObservationSheet()
  entered.study.region = 'synthetic region'
  assert.equal(observationSheetHasUserInput(entered), true)

  const measured = buildObservationSheet()
  measured.candidate.lines[0].observedProduct.available = false
  assert.equal(observationSheetHasUserInput(measured), true)
})

test('M3 reset confirmation never silently discards malformed nonblank metadata or product data', async t => {
  const invalidEntries = [
    ['study ID is number', s => { s.study.studyId = 123 }],
    ['study participant key is object', s => { s.study.participantKey = { corrupted: true } }],
    ['study price context is array', s => { s.study.priceContext = ['online-order'] }],
    ['baseline evidence ID is number', s => { s.baseline.evidenceId = 42 }],
    ['candidate provenance is object', s => { s.candidate.provenanceNote = { damaged: true } }],
    ['baseline store ID is numeric', s => { s.baseline.store.id = 99 }],
    ['candidate store name is array', s => { s.candidate.store.name = ['DekaMarkt'] }],
    ['baseline observed product name is array', s => { s.baseline.lines[0].observedProduct.productName = ['product'] }],
    ['candidate product ID is object', s => { s.candidate.lines[0].observedProduct.productId = { id: 'other' } }],
    ['baseline product source URL is boolean', s => { s.baseline.lines[0].observedProduct.sourceUrl = true }],
    ['candidate product note is number', s => { s.candidate.lines[0].observedProduct.note = 2026 }],
    ['candidate lines have missing last row', s => { s.candidate.lines.pop() }],
    ['baseline lines have an added row', s => { s.baseline.lines.push(structuredClone(s.baseline.lines[0])) }],
  ]
  for (const [name, corrupt] of invalidEntries) {
    await t.test(name, () => {
      const sheet = buildObservationSheet()
      corrupt(sheet)
      const untouched = structuredClone(sheet)
      assert.equal(observationSheetHasUserInput(sheet), true,
        'damaged noncanonical draft requires reset/import confirmation before destructive replacement')
      assert.deepEqual(sheet, untouched, 'guard may not normalize or change input')
    })
  }
})

test('M3 next-task navigation only targets a canonical ingredient/demand line', async t => {
  const positive = syntheticCompleteSheet()
  assert.equal(observationSheetReadiness(positive).ready, true)
  positive.candidate.lines[0].observedProduct.available = null
  assert.deepEqual(nextIncompleteObservationLine(positive), {
    side: 'candidate',
    ingredientId: positive.candidate.lines[0].ingredientId,
  })

  const invalidLineIdentity = [
    ['forged baseline ingredient ID', s => { s.baseline.lines[0].ingredientId = 'another-ingredient' }],
    ['changed baseline ingredient label', s => { s.baseline.lines[0].ingredientLabel = 'wrong demand' }],
    ['baseline demand amount differs', s => { s.baseline.lines[0].requirement.amount += 1 }],
    ['candidate requirement unit differs', s => { s.candidate.lines[0].requirement.unit = 'l' }],
    ['candidate requirement has injected property', s => { s.candidate.lines[0].requirement.offer = 'fake' }],
    ['baseline line has no requirement', s => { delete s.baseline.lines[0].requirement }],
  ]
  for (const [name, corrupt] of invalidLineIdentity) {
    await t.test(name, () => {
      const sheet = syntheticCompleteSheet()
      sheet.baseline.lines[0].observedProduct.available = null
      sheet.candidate.lines[0].observedProduct.available = null
      corrupt(sheet)
      const untouched = structuredClone(sheet)
      assert.equal(observationSheetReadiness(sheet).ready, false,
        'altered fixed demand is never ready to export')
      assert.equal(nextIncompleteObservationLine(sheet), null,
        'invalid demand must not result in a misleading collector navigation target')
      assert.deepEqual(sheet, untouched)
    })
  }
})
