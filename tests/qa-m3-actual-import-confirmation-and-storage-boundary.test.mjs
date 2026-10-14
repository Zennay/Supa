import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

import {
  buildObservationSheet,
  restoreObservationSheetDraft,
  observationSheetHasUserInput,
} from '../src/domain/m3ObservationSheet.ts'
import { observationDraftFileSizeAllowed } from '../src/features/observation/observationDraftImport.ts'

// QA executes the exact TSX closures used by the user's real Meten import
// screen. No copied implementation, browser networking, authentic prices
// or personal data. State setters are transparent, deterministic fakes.
const source = readFileSync(new URL(
  '../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile(
  'ObservationView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function loadHandler(name, deps) {
  let expression
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) {
      assert.equal(expression, undefined, name + ' must have one implementation')
      expression = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(expression && ts.isArrowFunction(expression), 'actual handler: ' + name)
  const compiled = ts.transpileModule(
    'const __qa = ' + expression.getText(ast) + ';',
    {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
      fileName: name + '.ts', reportDiagnostics: true,
    },
  )
  assert.deepEqual(compiled.diagnostics, [], 'actual TSX closure transpiles cleanly')
  return new Function(...deps, compiled.outputText + '\nreturn __qa')
}

const newApply = loadHandler('applyImportedDraft', [
  'draftRecoveryNeeded', 'setImportStatus', 'setSheet', 'setPendingImport',
])
const newImport = loadHandler('importDraft', [
  'observationDraftFileSizeAllowed', 'setPendingImport', 'setImportStatus',
  'restoreObservationSheetDraft', 'observationSheetHasUserInput', 'sheet',
  'applyImportedDraft', 'importRequestRef', 'sheetRevisionRef', 'latestSheetRef',
])

function importedSheet() {
  const sheet = buildObservationSheet()
  sheet.study.studyId = 'synthetic-import-only'
  sheet.study.participantKey = 'qa-anon-only'
  sheet.baseline.lines[0].observedProduct.available = false
  return sheet
}

function harness({ existing = false, quarantined = false } = {}) {
  const state = {
    sheet: buildObservationSheet(), pending: null, status: null,
    events: [],
  }
  if (existing) {
    state.sheet.study.studyId = 'synthetic-older-observation'
    state.sheet.baseline.lines[0].observedProduct.available = false
  }
  function setSheet(sheet) {
    state.events.push('setSheet')
    state.sheet = sheet
  }
  function setPendingImport(value) {
    state.events.push('setPending')
    state.pending = value
  }
  function setImportStatus(value) {
    state.events.push('setStatus:' + value.kind)
    state.status = value
  }
  const apply = newApply(quarantined, setImportStatus, setSheet, setPendingImport)
  const importFile = newImport(
    observationDraftFileSizeAllowed, setPendingImport, setImportStatus,
    restoreObservationSheetDraft, observationSheetHasUserInput,
    state.sheet, apply,
    { current: 0 }, { current: 0 }, { current: state.sheet },
  )
  return { state, apply, importFile }
}
const CANDIDATE = importedSheet()
const RAW = JSON.stringify(CANDIDATE)

function file(text = RAW, options = {}) {
  let reads = 0
  return {
    size: options.size ?? Buffer.byteLength(text),
    async text() {
      reads++
      if (options.readFails) throw new Error('fictional private file read denied')
      return text
    },
    readCount: () => reads,
  }
}

test('real M3 import: blank form accepts structurally valid 11+11 draft only after async read', async () => {
  const h = harness()
  const old = structuredClone(h.state.sheet)
  const upload = file()
  assert.equal(observationSheetHasUserInput(h.state.sheet), false)
  await h.importFile(upload)
  assert.equal(upload.readCount(), 1)
  assert.deepEqual(h.state.sheet, CANDIDATE)
  assert.notDeepEqual(h.state.sheet, old)
  assert.equal(h.state.pending, null)
  assert.equal(h.state.status.kind, 'success')
  assert.match(h.state.status.message, /een aparte controle bepaalt/)
  assert.deepEqual(h.state.events,
    ['setSheet', 'setPending', 'setStatus:success'])
  assert.equal(h.state.sheet.baseline.lines.length, 11)
  assert.equal(h.state.sheet.candidate.lines.length, 11)
})

test('real M3 import: existing observations cannot be overwritten before explicit confirmation', async () => {
  const h = harness({ existing: true })
  const old = structuredClone(h.state.sheet)
  const upload = file()
  await h.importFile(upload)
  assert.equal(upload.readCount(), 1)
  assert.deepEqual(h.state.sheet, old, 'human entry remains unchanged')
  assert.deepEqual(h.state.pending, CANDIDATE)
  assert.equal(h.state.status.kind, 'warning')
  assert.match(h.state.status.message, /Kies expliciet/)
  assert.equal(h.state.events.includes('setSheet'), false)
  h.apply(h.state.pending)
  assert.deepEqual(h.state.sheet, CANDIDATE)
  assert.equal(h.state.pending, null)
  assert.equal(h.state.status.kind, 'success')
  assert.equal(h.state.events.filter(event => event === 'setSheet').length, 1)
})

for (const [name, upload] of [
  ['invalid-json', () => file('{not valid')],
  ['unknown-schema', () => {
    const future = importedSheet()
    future.schemaVersion = 99
    return file(JSON.stringify(future))
  }],
  ['read-denied', () => file(RAW, { readFails: true })],
  ['oversized', () => file(RAW, { size: 2_000_000 })],
]) {
  test('real M3 import: ' + name + ' cannot wipe existing local evidence', async () => {
    const h = harness({ existing: true })
    const before = structuredClone(h.state.sheet)
    const f = upload()
    await h.importFile(f)
    assert.deepEqual(h.state.sheet, before)
    assert.equal(h.state.pending, null)
    assert.equal(h.state.status.kind, 'error')
    assert.equal(h.state.events.includes('setSheet'), false)
    assert.equal(f.readCount(), name === 'oversized' ? 0 : 1)
  })
}

test('real M3 recovery quarantine refuses applying a new draft over unreadable original', async () => {
  const h = harness({ existing: true, quarantined: true })
  const old = structuredClone(h.state.sheet)
  h.apply(CANDIDATE)
  assert.deepEqual(h.state.sheet, old)
  assert.equal(h.state.status.kind, 'error')
  assert.match(h.state.status.message, /Import is gepauzeerd/)
  assert.equal(h.state.events.includes('setSheet'), false)
})
