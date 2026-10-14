import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

import * as observationSheetDomain from '../src/domain/m3ObservationSheet.ts'
import * as collectionUi from '../src/features/observation/observationCollectionUi.ts'
import * as observationPresentation from '../src/features/observation/observationPresentation.ts'
import * as numericInput from '../src/features/observation/observationNumericInput.ts'
import * as draftPersistence from '../src/features/observation/observationDraftPersistence.ts'
import * as draftImport from '../src/features/observation/observationDraftImport.ts'
import { observationNextAction, observationNextTaskSelector } from '../src/features/observation/observationNextStep.ts'
import * as observationReadinessCopy from '../src/features/observation/observationReadinessCopy.ts'
import * as observationRequiredLineField from '../src/features/observation/observationRequiredLineField.ts'
import * as observationVisibleRows from '../src/features/observation/observationVisibleRows.ts'

const require = createRequire(import.meta.url)
const jsxRuntime = require('react/jsx-runtime')

function compile(relative, filename, cssName) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
    .replace(new RegExp("^import\\s+['\\x22]\\./" + cssName.replaceAll('.', '\\.') +
      "['\\x22]\\s*;?\\s*$", 'm'), '')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
    reportDiagnostics: true,
  })
  assert.deepEqual(compiled.diagnostics, [])
  return compiled.outputText
}

function evaluate(output, modules) {
  const module = { exports: {} }
  new Function('module', 'exports', 'require', output)(
    module, module.exports, (name) => {
      if (name === 'react') return React
      if (name === 'react/jsx-runtime') return jsxRuntime
      assert.ok(Object.hasOwn(modules, name), 'Unexpected ObservationView import ' + name)
      return modules[name]
    },
  )
  return module.exports
}

const card = evaluate(
  compile('../src/features/observation/ObservationNextActionCard.tsx',
    'ObservationNextActionCard.tsx', 'ObservationNextActionCard.css'),
  { './ObservationNextActionCard.css': {} },
).ObservationNextActionCard

const priceInput = evaluate(
  compile('../src/features/observation/ObservationPriceInput.tsx',
    'ObservationPriceInput.tsx', '__no_css__'),
  { './observationCollectionUi.ts': collectionUi },
).ObservationPriceInput

const packAmountInput = evaluate(
  compile('../src/features/observation/ObservationPackAmountInput.tsx',
    'ObservationPackAmountInput.tsx', '__no_css__'),
  {},
).ObservationPackAmountInput

const packCountInput = evaluate(
  compile('../src/features/observation/ObservationPackCountInput.tsx',
    'ObservationPackCountInput.tsx', '__no_css__'),
  {},
).ObservationPackCountInput

const actualView = compile('../src/features/observation/ObservationView.tsx',
  'ObservationView.tsx', 'ObservationView.css')

function renderView(sheet) {
  const modules = {
    './ObservationView.css': {},
    '../../domain/m3ObservationSheet.ts': {
      ...observationSheetDomain,
      buildObservationSheet: () => structuredClone(sheet),
    },
    './observationPresentation.ts': observationPresentation,
    // Existing main already routes Dutch quantity components; this guide SSR harness
    // does not own or replace the separate quantity presentation contract.
    './ObservationQuantityFields': {
      ObservationRequirementText: ({ amount, unit }) =>
        React.createElement('span', null, `${amount ?? '?'} ${unit}`),
      ObservationPackUnitOptions: () => null,
    },
    './observationCollectionUi.ts': collectionUi,
    './observationNumericInput.ts': numericInput,
    './observationDraftPersistence.ts': draftPersistence,
    './observationDraftImport.ts': draftImport,
    './observationNextStep.ts': { observationNextAction, observationNextTaskSelector },
    './observationReadinessCopy.ts': observationReadinessCopy,
    './ObservationNextActionCard.tsx': { ObservationNextActionCard: card },
    './ObservationPriceInput.tsx': { ObservationPriceInput: priceInput },
    './ObservationPackAmountInput.tsx': { ObservationPackAmountInput: packAmountInput },
    './ObservationPackCountInput.tsx': { ObservationPackCountInput: packCountInput },
    './observationRequiredLineField.ts': observationRequiredLineField,
    './observationVisibleRows.ts': observationVisibleRows,
  }
  const ObservationView = evaluate(actualView, modules).ObservationView
  return renderToStaticMarkup(React.createElement(ObservationView))
}

function populatedSheet() {
  const sheet = observationSheetDomain.buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'study-controlled',
    participantKey: 'anon-001',
    population: 'Uitwonende studenten',
    region: 'Leiden',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const [side, retailer, time] of [
    ['baseline', 'PLUS', '2026-10-10T09:00:00Z'],
    ['candidate', 'DekaMarkt', '2026-10-10T10:00:00Z'],
  ]) {
    Object.assign(sheet[side], {
      evidenceId: side + '-evidence',
      observedAt: time,
      provenanceNote: 'Handmatige winkelmand',
      store: { id: side + '-leiden', name: retailer + ' Leiden' },
    })
  }
  for (const side of ['baseline', 'candidate']) {
    for (const line of sheet[side].lines) line.observedProduct.available = false
  }
  return sheet
}

test('the actual ObservationView renders one task-first accessible guide on a fresh sheet', () => {
  const sheet = observationSheetDomain.buildObservationSheet()
  const before = structuredClone(sheet)
  const html = renderView(sheet)
  assert.equal((html.match(/class="observation-next-action"/g) || []).length, 1)
  assert.match(html, /role="status" aria-label="Volgende stap" aria-live="polite"/)
  assert.match(html, /Geef deze meting een code/)
  assert.match(html, /Kies een herkenbare code/)
  assert.match(html, /Meten zonder gokken/)
  assert.match(html, /Echte winkelprijzen verzamelen/)
  assert.match(html, /Controle voor bewaren/)
  assert.match(html, /Gegevens van deze meting/)
  assert.match(html, /Anonieme deelnemerscode/)
  assert.doesNotMatch(html, />Preflight<|>Study ID<|>Pseudonieme participant key</)
  assert.doesNotMatch(html, />Klaar voor de M3-converter</)

  assert.doesNotMatch(html, /class="ghost-button observation-next-button"[^>]*disabled/)
  assert.match(html, /Ga naar: Geef deze meting een code/)
  assert.match(html, /data-observation-study-field="studyId"/)
  assert.match(html, /Nog .* controle/)
  assert.deepEqual(sheet, before, 'render never mutates input evidence')
})

test('a completed actual observation form still calls draft export a review step, never proven savings', () => {
  const sheet = populatedSheet()
  assert.equal(observationSheetDomain.observationSheetReadiness(sheet).ready, true)
  const html = renderView(sheet)
  assert.equal((html.match(/class="observation-next-action"/g) || []).length, 1)
  assert.match(html, /Bewaar de ingevulde winkelmetingen/)
  assert.match(html, /nog geen besparing/)
  assert.match(html, /Een aparte controle/)
  assert.doesNotMatch(
    html.match(/class="observation-next-action"[\s\S]*?<\/div>/)?.[0] ?? '',
    /besparing bewezen|100%|klaar voor publicatie/i,
  )
})

test('actual observation screen points to recollection for measurements outside 24 hours', () => {
  const sheet = populatedSheet()
  sheet.baseline.observedAt = '2026-10-08T09:00:00Z'
  const html = renderView(sheet)
  assert.match(html, /Meet beide winkels binnen 24 uur/)
  assert.match(html, /pas de tijden niet kunstmatig aan/)
  assert.match(html, /24u-venster overschreden/)
})

test('task-first integration does not auto-export or change the canonical readiness gate', () => {
  const source = readFileSync(
    new URL('../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8',
  )
  assert.match(source, /const nextAction = useMemo\(\(\) => observationNextAction\(sheet\), \[sheet\]\)/)
  assert.match(source, /<ObservationNextActionCard action=\{nextAction\} \/>/)
  assert.match(source, /const readiness = useMemo\(\(\) => observationSheetReadiness\(sheet\), \[sheet\]\)/)
  assert.match(source, /onClick=\{jumpToNextIncomplete\}/)
  assert.match(source, /const downloadDraft = \(\) =>/)
})

test('real M3 line-jump control appears only for current canonical ingredient task', () => {
  const studyReady = populatedSheet()
  studyReady.baseline.lines[0].observedProduct.available = null
  assert.equal(observationNextAction(studyReady).stage, 'line')
  const html = renderView(studyReady)
  assert.match(html, /class="ghost-button observation-next-button"/)
  assert.doesNotMatch(html, /class="ghost-button observation-next-button"[^>]*disabled/)
  assert.match(html, /Volgende stap/)
  assert.match(html, /PLUS/)
  assert.match(html, /Basmati rijst/)

  const notReady = observationSheetDomain.buildObservationSheet()
  assert.equal(observationNextAction(notReady).stage, 'study')
  const setupHtml = renderView(notReady)
  assert.doesNotMatch(setupHtml, /class="ghost-button observation-next-button"[^>]*disabled/)
  assert.match(setupHtml, /Ga naar: Geef deze meting een code/)
  assert.match(setupHtml, /data-observation-study-field="studyId"/)

  const complete = populatedSheet()
  assert.equal(observationNextAction(complete).stage, 'export')
  const exportHtml = renderView(complete)
  assert.doesNotMatch(exportHtml, /class="ghost-button observation-next-button"[^>]*disabled/)
  assert.match(exportHtml, /Ga naar: JSON-concept bewaren/)
  assert.match(exportHtml, /data-observation-export-target/)

  const review = populatedSheet()
  review.baseline.observedAt = '2026-10-08T09:00:00Z'
  assert.equal(observationNextAction(review).stage, 'review')
  const reviewHtml = renderView(review)
  assert.doesNotMatch(reviewHtml, /class="ghost-button observation-next-button"[^>]*disabled/)
  assert.match(reviewHtml, /Ga naar: controlepunten/)
  assert.match(reviewHtml, /data-observation-review-target/)
  assert.match(reviewHtml, /24u-venster overschreden/)
})

test('real Meten input labels explain M3 store provenance and privacy without changing field keys', () => {
  const sheet = observationSheetDomain.buildObservationSheet()
  const before = structuredClone(sheet)
  const html = renderView(sheet)
  for (const [label, field] of [
    ['Doelgroep', 'population'],
    ['Gebied', 'region'],
    ['Hoe zijn de prijzen gemeten?', 'priceContext'],
    ['Startdatum van je planweek', 'weekStart'],
  ]) {
    assert.match(html, new RegExp(label.replace(/[?]/g, '\\?') +
      '[\\s\\S]*?data-observation-study-field="' + field + '"'))
  }
  for (const [label, field] of [
    ['Vestigingscode', 'id'],
    ['Code van deze winkelmeting', 'evidenceId'],
    ['Hoe heb je de prijzen vastgelegd?', 'provenanceNote'],
  ]) {
    assert.match(html, new RegExp(label.replace(/[?]/g, '\\?') +
      '[\\s\\S]*?data-observation-store-field="' + field + '"'))
  }
  assert.match(html, /Gebruik geen naam of e-mailadres/)
  assert.match(html, /Beschrijf de bron en het meetmoment/)
  assert.doesNotMatch(html, />Evidence ID<|>Provenance-notitie<|>Week start<|>Winkel-ID</)
  assert.deepEqual(sheet, before)
})

test('actual M3 React UI focuses invalid normalized-looking observation times', () => {
  const sheet = populatedSheet()
  // Date.parse may roll 30 February into March; canonical readiness rejects it.
  sheet.baseline.observedAt = '2026-02-30T09:00:00Z'
  const before = structuredClone(sheet)
  assert.equal(observationSheetDomain.observationSheetReadiness(sheet).ready, false)
  assert.equal(observationNextAction(sheet).field, 'observedAt')
  const html = renderView(sheet)
  assert.match(html, /Ga naar: Controleer de datum en tijd van PLUS/)
  assert.match(html, /data-observation-store-field="observedAt"/)
  assert.doesNotMatch(html, /Ga naar: JSON-concept bewaren/)
  assert.deepEqual(sheet, before, 'rendering cannot rewrite the human observation')
})

test('actual M3 React UI redirects duplicate shop codes instead of suggesting export', () => {
  const sheet = populatedSheet()
  sheet.candidate.store.id = sheet.baseline.store.id
  const before = structuredClone(sheet)
  assert.equal(observationSheetDomain.observationSheetReadiness(sheet).ready, false)
  const action = observationNextAction(sheet)
  assert.equal(action.stage, 'store')
  assert.equal(action.side, 'candidate')
  assert.equal(action.field, 'id')
  const html = renderView(sheet)
  assert.match(html, /Ga naar: Controleer de vestigingscode van DekaMarkt/)
  assert.match(html, /verzin geen code/)
  assert.match(html, /data-observation-store-field="id"/)
  assert.doesNotMatch(html, /Ga naar: JSON-concept bewaren/)
  assert.deepEqual(sheet, before, 'UI may guide but must not fix the identity by guesswork')
})

test('real React M3 next-action card names the exact field rather than a generic checklist', () => {
  const sheet = populatedSheet()
  const product = sheet.baseline.lines[0].observedProduct
  product.available = true
  product.productName = 'Fictief gezien product'
  product.packAmount = 500
  product.packUnit = 'g'
  product.packCount = 1
  product.priceCents = null
  const before = structuredClone(sheet)
  const html = renderView(sheet)
  const start = html.indexOf('class="observation-next-action"')
  const cardHtml = start < 0 ? '' : html.slice(start, html.indexOf('</div>', start) + 6)
  assert.match(cardHtml, /Volgende: PLUS/)
  assert.match(cardHtml, /werkelijk geobserveerde prijs per verpakking/)
  assert.doesNotMatch(cardHtml, /Controleer beschikbaarheid, product, verpakking en prijs/)
  assert.doesNotMatch(cardHtml, /besparing bewezen|klaar voor publicatie/i)
  assert.match(html, /data-observation-product-field="priceCents"/)
  assert.deepEqual(sheet, before, 'task-first UI never writes a fictional price')
})
