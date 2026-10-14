import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildObservationSheet,
  observationLineCollectionComplete,
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'
import { observationNextAction } from '../src/features/observation/observationNextStep.ts'
import {
  observationNextRequiredProductField,
} from '../src/features/observation/observationRequiredLineField.ts'

// Deliberately fictional, incomplete M3 measurement fixtures. No price claims.
function activeSheet(side) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-field-guide',
    participantKey: 'anonymous-controlled',
    population: 'Studenten',
    region: 'Leiden',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
  })
  for (const [sideKey, name, observedAt] of [
    ['baseline', 'PLUS Leiden', '2026-10-14T08:00:00Z'],
    ['candidate', 'DekaMarkt Leiden', '2026-10-14T09:00:00Z'],
  ]) {
    const store = sheet[sideKey]
    store.store.id = sideKey + '-synthetic'
    store.store.name = name
    store.evidenceId = sideKey + '-evidence'
    store.observedAt = observedAt
    store.provenanceNote = 'Handmatige fictieve regressie'
  }
  if (side === 'candidate') {
    sheet.baseline.lines.forEach((line) => { line.observedProduct.available = false })
  }
  return sheet
}

test('each incomplete real store row announces exactly the first field needed', () => {
  for (const side of ['baseline', 'candidate']) {
    const sheet = activeSheet(side)
    const product = sheet[side].lines[0].observedProduct
    const steps = [
      ['available', /beschikbaar of niet beschikbaar/],
      ['productName', /werkelijke productnaam/],
      ['packAmount', /werkelijke hoeveelheid per verpakking/],
      ['packUnit', /eenheid.*verpakking/],
      ['packCount', /werkelijke aantal.*verpakking/],
      ['priceCents', /werkelijk geobserveerde prijs/],
    ]
    const next = (field, message) => {
      const before = structuredClone(sheet)
      assert.equal(observationNextRequiredProductField(sheet[side].lines[0]), field)
      assert.equal(observationLineCollectionComplete(sheet[side].lines[0]), false)
      const action = observationNextAction(sheet)
      assert.equal(action.stage, 'line', field)
      assert.equal(action.side, side, field)
      assert.equal(action.ingredientId, sheet[side].lines[0].ingredientId)
      assert.match(action.title, side === 'baseline' ? /PLUS/ : /DekaMarkt/)
      assert.match(action.detail, message, field)
      assert.match(action.detail, /Laat onbekende gegevens open/)
      assert.doesNotMatch(action.detail, /M3|converter|besparing bewezen|gegarandeerd/i)
      assert.deepEqual(sheet, before, 'guidance never changes a saved measurement')
      assert.equal(observationSheetReadiness(sheet).ready, false)
    }

    next(...steps[0])
    product.available = true
    next(...steps[1])
    product.productName = 'Fictief gecontroleerd product'
    next(...steps[2])
    product.packAmount = 0.75
    next(...steps[3])
    product.packUnit = 'g'
    // The canonical blank sheet defaults packCount to 1; force invalid so
    // its specific repair hint is checked rather than skipping that step.
    product.packCount = 0
    next(...steps[4])
    product.packCount = 1
    next(...steps[5])
    product.priceCents = 0
    assert.equal(observationLineCollectionComplete(sheet[side].lines[0]), true)
    const following = observationNextAction(sheet)
    assert.equal(following.stage, 'line')
    assert.equal(following.side, side)
    assert.notEqual(following.ingredientId, sheet[side].lines[0].ingredientId)
  }
})

test('explicitly unavailable goods skip pack and price prompts without inventing a zero', () => {
  for (const side of ['baseline', 'candidate']) {
    const sheet = activeSheet(side)
    sheet[side].lines[0].observedProduct.available = false
    const before = structuredClone(sheet)
    const action = observationNextAction(sheet)
    assert.equal(action.stage, 'line')
    assert.equal(action.side, side)
    assert.notEqual(action.ingredientId, sheet[side].lines[0].ingredientId)
    assert.deepEqual(sheet, before)
    assert.equal(sheet[side].lines[0].observedProduct.priceCents, null)
  }
})

test('malformed sheet cannot become export-ready via an optimistic field hint', () => {
  for (const value of [null, {}, { baseline: [] }, { study: null }, []]) {
    const action = observationNextAction(value)
    assert.equal(action.stage, 'review')
    assert.notEqual(action.stage, 'export')
  }
})
