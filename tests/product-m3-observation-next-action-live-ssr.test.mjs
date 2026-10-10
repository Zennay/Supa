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
import { observationNextAction } from '../src/features/observation/observationNextStep.ts'

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
    './observationCollectionUi.ts': collectionUi,
    './observationNumericInput.ts': numericInput,
    './observationDraftPersistence.ts': draftPersistence,
    './observationDraftImport.ts': draftImport,
    './observationNextStep.ts': { observationNextAction },
    './ObservationNextActionCard.tsx': { ObservationNextActionCard: card },
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

  assert.match(html, /class="ghost-button observation-next-button"[^>]*disabled=""/, 'study setup cannot jump past metadata')
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
  assert.match(renderView(notReady), /class="ghost-button observation-next-button"[^>]*disabled=""/)

  const complete = populatedSheet()
  assert.equal(observationNextAction(complete).stage, 'export')
  assert.match(renderView(complete), /class="ghost-button observation-next-button"[^>]*disabled=""/)
})
