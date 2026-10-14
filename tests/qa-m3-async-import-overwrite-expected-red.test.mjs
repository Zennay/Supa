import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import {
  buildObservationSheet, restoreObservationSheetDraft,
  observationSheetHasUserInput,
} from '../src/domain/m3ObservationSheet.ts'
import { observationDraftFileSizeAllowed } from '../src/features/observation/observationDraftImport.ts'

// Deliberately RED independent QA: execute the *actual production* async
// ObservationView import closure against a controlled delayed local File.
// No real participant, supermarket data, network, disk or product edits.
const source = readFileSync(new URL(
  '../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile(
  'ObservationView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function originalArrow(name, deps) {
  let found
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) {
      assert.equal(found, undefined)
      found = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(found && ts.isArrowFunction(found), 'missing real production handler: ' + name)
  const output = ts.transpileModule('const __actual = ' + found.getText(ast) + ';', {
    fileName: name + '.ts',
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    reportDiagnostics: true,
  })
  assert.deepEqual(output.diagnostics, [])
  return new Function(...deps, output.outputText + '\nreturn __actual')
}
const actualApply = originalArrow('applyImportedDraft', [
  'draftRecoveryNeeded', 'setImportStatus', 'setSheet', 'setPendingImport',
])
const actualImport = originalArrow('importDraft', [
  'observationDraftFileSizeAllowed', 'setPendingImport', 'setImportStatus',
  'restoreObservationSheetDraft', 'observationSheetHasUserInput',
  'sheet', 'applyImportedDraft',
])

test('QA expected RED: editing a blank 11+11 sheet while a File.text read is pending cannot silently overwrite newly observed data', async () => {
  const state = {
    sheet: buildObservationSheet(), pending: null, status: null,
    calls: [],
  }
  const originalBlankSheet = state.sheet
  const setSheet = value => {
    state.calls.push('setSheet')
    state.sheet = value
  }
  const setPendingImport = value => { state.calls.push('pending'); state.pending = value }
  const setImportStatus = value => { state.calls.push('status:' + value.kind); state.status = value }
  const apply = actualApply(false, setImportStatus, setSheet, setPendingImport)
  // Capture the actual handler from the original blank-form render, as React
  // does when the browser's file input invokes a handler before an await.
  const importFile = actualImport(
    observationDraftFileSizeAllowed, setPendingImport, setImportStatus,
    restoreObservationSheetDraft, observationSheetHasUserInput,
    originalBlankSheet, apply,
  )

  const incoming = buildObservationSheet()
  incoming.study.studyId = 'fictional-import-candidate'
  incoming.study.participantKey = 'anon-test-candidate'
  incoming.baseline.lines[0].observedProduct.available = false
  const incomingRaw = JSON.stringify(incoming)
  let finishReading
  const f = {
    size: Buffer.byteLength(incomingRaw),
    text() { return new Promise(resolve => { finishReading = resolve }) },
  }
  const importTask = importFile(f)
  assert.equal(typeof finishReading, 'function', 'file is really pending')

  // A person enters a genuine-looking but fictional new field while their
  // browser is still waiting for the local file read to complete. This is a
  // new React state object, so the old handler closure sees the stale blank.
  const justEntered = structuredClone(state.sheet)
  justEntered.study.studyId = 'local-unsaved-user-progress'
  justEntered.baseline.lines[0].observedProduct.available = false
  setSheet(justEntered)
  assert.equal(observationSheetHasUserInput(state.sheet), true)

  finishReading(incomingRaw)
  await importTask

  // The correct behavior is the same explicit confirmation already promised
  // when data existed before the import started, not a silent replacement.
  assert.deepEqual(state.sheet, justEntered,
    'an async import must not erase a user edit made during pending File.text()')
  assert.deepEqual(state.pending, incoming,
    'incoming draft must wait for the user to explicitly approve replacement')
  assert.equal(state.status.kind, 'warning')
  assert.match(state.status.message, /Kies expliciet/)
})
