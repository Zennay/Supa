import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildObservationSheet,
  nextIncompleteObservationLine,
  observationLineCollectionComplete,
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'
import {
  observationNextAction,
  observationNextTaskSelector,
} from '../src/features/observation/observationNextStep.ts'
import { observationNextRequiredProductField } from '../src/features/observation/observationRequiredLineField.ts'

// Independent quality-validation 2/2 of the original product owner #2437.
// Every observation is fictional and incomplete. No network, retail data,
// participant details, published prices/savings or product-source edits.
function canonicalForm(side, index) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'qa-task-routing',
    participantKey: 'anonymous-qa-only',
    population: 'fictieve studenten',
    region: 'testgebied',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
  })
  for (const [key, name, when] of [
    ['baseline', 'PLUS testvestiging', '2026-10-13T09:00:00Z'],
    ['candidate', 'DekaMarkt testvestiging', '2026-10-13T10:00:00Z'],
  ]) {
    Object.assign(sheet[key], {
      store: { name, id: 'fictional-' + key },
      evidenceId: 'synthetic-' + key,
      provenanceNote: 'Fictieve QA-controle',
      observedAt: when,
      source: 'manual-cart',
    })
  }
  if (side === 'candidate') {
    for (const row of sheet.baseline.lines) row.observedProduct.available = false
  }
  for (let position = 0; position < index; position++) {
    sheet[side].lines[position].observedProduct.available = false
  }
  return sheet
}

const STATES = [
  ['available', /beschikbaar of niet beschikbaar/],
  ['productName', /werkelijke productnaam/],
  ['packAmount', /werkelijke hoeveelheid per verpakking/],
  ['packUnit', /eenheid.*verpakking/],
  ['packCount', /werkelijke aantal/],
  ['priceCents', /werkelijk geobserveerde prijs/],
]

test('independent 22 × 6 M3 real ingredient tasks stay store- and field-specific', () => {
  let cases = 0
  for (const side of ['baseline', 'candidate']) {
    for (let index = 0; index < 11; index++) {
      const sheet = canonicalForm(side, index)
      const row = sheet[side].lines[index]
      const product = row.observedProduct
      for (const [field, guidance] of STATES) {
        const before = JSON.stringify(sheet)
        const target = nextIncompleteObservationLine(sheet)
        const action = observationNextAction(sheet)

        assert.deepEqual(target, { side, ingredientId: row.ingredientId })
        assert.equal(observationNextRequiredProductField(row), field)
        assert.equal(observationLineCollectionComplete(row), false)
        assert.equal(observationSheetReadiness(sheet).ready, false)
        assert.equal(action.stage, 'line', side + ' #' + index + ' ' + field)
        assert.equal(action.side, side)
        assert.equal(action.ingredientId, row.ingredientId)
        assert.match(action.title, side === 'baseline' ? /PLUS/ : /DekaMarkt/)
        assert.match(action.detail, guidance)
        assert.match(action.detail, /Laat onbekende gegevens open/)
        assert.doesNotMatch(action.title + action.detail,
          /klaar voor publicatie|besparing bewezen|gegarandeerd/i)
        assert.equal(observationNextTaskSelector(action), null,
          'line navigation uses canonical ingredient identity, never an injected CSS selector')
        assert.equal(JSON.stringify(sheet), before, 'guidance cannot fill any observation')
        cases++

        if (field === 'available') product.available = true
        else if (field === 'productName') product.productName = 'Fictief product'
        else if (field === 'packAmount') product.packAmount = 0.5
        else if (field === 'packUnit') {
          product.packUnit = 'g'
          product.packCount = 0
        } else if (field === 'packCount') product.packCount = 1
        else if (field === 'priceCents') product.priceCents = 0
      }
      assert.equal(observationLineCollectionComplete(row), true)
      const next = observationNextAction(sheet)
      assert.notEqual(next.ingredientId, row.ingredientId,
        'a truly complete row advances, never loops on itself')
    }
  }
  assert.equal(cases, 132)
})

test('independent all-22 unavailable and 0-cent boundaries never infer prices/savings', () => {
  const sheet = canonicalForm('candidate', 0)
  for (const row of sheet.candidate.lines) row.observedProduct.available = false
  assert.equal(nextIncompleteObservationLine(sheet), null)
  assert.equal(observationSheetReadiness(sheet).ready, true)
  const action = observationNextAction(sheet)
  assert.equal(action.stage, 'export')
  assert.match(action.detail, /nog geen besparing/)
  assert.equal(observationNextTaskSelector(action), null)
  for (const side of ['baseline', 'candidate']) {
    assert.equal(sheet[side].lines.length, 11)
    for (const row of sheet[side].lines) {
      assert.equal(row.observedProduct.priceCents, null,
        'unavailable is an observation, never a fabricated zero price')
    }
  }

  const priced = canonicalForm('baseline', 0)
  const product = priced.baseline.lines[0].observedProduct
  Object.assign(product, {
    available: true, productName: 'Fictief product',
    packAmount: 1, packUnit: 'piece', packCount: 1, priceCents: 0,
  })
  assert.equal(observationLineCollectionComplete(priced.baseline.lines[0]), true,
    'a genuinely observed zero-cent price is not missing')
  assert.equal(observationNextAction(priced).ingredientId,
    priced.baseline.lines[1].ingredientId)
})
