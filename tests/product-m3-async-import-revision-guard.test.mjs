import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import {
  buildObservationSheet, observationSheetHasUserInput, restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'
import { observationDraftFileSizeAllowed } from '../src/features/observation/observationDraftImport.ts'

const source = readFileSync(
  new URL('../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8',
)
const ast = ts.createSourceFile('ObservationView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function loadActualHandler(name, deps) {
  let original
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) {
      assert.equal(original, undefined, 'one production handler: ' + name)
      original = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(original && ts.isArrowFunction(original), 'actual TSX handler exists: ' + name)
  const output = ts.transpileModule('const actual = ' + original.getText(ast), {
    fileName: name + '.ts',
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    reportDiagnostics: true,
  })
  assert.deepEqual(output.diagnostics, [])
  return new Function(...deps, output.outputText + '\nreturn actual')
}

const createActualApply = loadActualHandler('applyImportedDraft',
  ['draftRecoveryNeeded', 'setImportStatus', 'setSheet', 'setPendingImport'])
const createActualImport = loadActualHandler('importDraft', [
  'observationDraftFileSizeAllowed', 'setPendingImport', 'setImportStatus',
  'restoreObservationSheetDraft', 'observationSheetHasUserInput',
  'sheet', 'applyImportedDraft', 'importRequestRef', 'sheetRevisionRef', 'latestSheetRef',
])

function fixture(studyId = 'fictional-incoming-m3') {
  const sheet = buildObservationSheet()
  sheet.study.studyId = studyId
  sheet.study.participantKey = 'anonymous-regression'
  sheet.baseline.lines[0].observedProduct.available = false
  return sheet
}

function harness(start = buildObservationSheet(), quarantine = false) {
  const state = { sheet: start, pending: null, status: null, events: [] }
  const latestSheetRef = { current: state.sheet }
  const sheetRevisionRef = { current: 0 }
  const importRequestRef = { current: 0 }
  function setSheet(value) {
    state.events.push('setSheet')
    state.sheet = value
    // Model committed React state + useLayoutEffect after each new sheet:
    if (latestSheetRef.current !== value) {
      latestSheetRef.current = value
      sheetRevisionRef.current += 1
    }
  }
  function setPendingImport(value) {
    state.events.push('pending')
    state.pending = value
  }
  function setImportStatus(value) {
    state.events.push('status:' + value.kind)
    state.status = value
  }
  const applyImportedDraft = createActualApply(
    quarantine, setImportStatus, setSheet, setPendingImport,
  )
  const importDraft = createActualImport(
    observationDraftFileSizeAllowed, setPendingImport, setImportStatus,
    restoreObservationSheetDraft, observationSheetHasUserInput,
    state.sheet, applyImportedDraft,
    importRequestRef, sheetRevisionRef, latestSheetRef,
  )
  return { state, setSheet, importDraft, applyImportedDraft, refs: {
    importRequestRef, sheetRevisionRef, latestSheetRef,
  } }
}

function delayedFile(sheet = fixture()) {
  const raw = JSON.stringify(sheet)
  let finish, fail
  let reads = 0
  return {
    size: Buffer.byteLength(raw),
    text() {
      reads += 1
      return new Promise((resolve, reject) => { finish = resolve; fail = reject })
    },
    resolve() { assert.ok(finish); finish(raw) },
    reject() { assert.ok(fail); fail(new Error('denied')) },
    get reads() { return reads },
  }
}

test('the real import closure stages confirmation for new edits made during a pending file read', async () => {
  const h = harness()
  const candidate = fixture()
  const file = delayedFile(candidate)
  const started = h.importDraft(file)
  const newer = structuredClone(h.state.sheet)
  newer.study.studyId = 'local-field-entry-must-survive'
  newer.baseline.lines[0].observedProduct.available = false
  h.setSheet(newer)
  file.resolve()
  await started

  assert.deepEqual(h.state.sheet, newer, 'do not overwrite a new human field observation')
  assert.deepEqual(h.state.pending, candidate, 'wait for explicit replacement confirmation')
  assert.equal(h.state.status.kind, 'warning')
  assert.match(h.state.status.message, /Kies expliciet/)
  assert.equal(h.state.events.filter(x => x === 'setSheet').length, 1)
  assert.equal(h.refs.sheetRevisionRef.current, 1)
  h.applyImportedDraft(h.state.pending)
  assert.deepEqual(h.state.sheet, candidate, 'explicit user-approved replacement remains possible')
})

test('edits reverted to a blank form still prevent an old import from auto-opening', async () => {
  const h = harness()
  const original = structuredClone(h.state.sheet)
  const file = delayedFile()
  const started = h.importDraft(file)
  h.setSheet(fixture('intermediate-field-entry'))
  h.setSheet(original)
  assert.equal(observationSheetHasUserInput(h.state.sheet), false)
  file.resolve()
  await started
  assert.deepEqual(h.state.sheet, original)
  assert.deepEqual(h.state.pending, fixture())
  assert.equal(h.state.status.kind, 'warning')
  assert.equal(h.refs.sheetRevisionRef.current, 2)
})

test('two concurrent imports: the newest selected file wins even when the older read resolves last', async () => {
  const h = harness()
  const older = delayedFile(fixture('older-import-file'))
  const newer = delayedFile(fixture('newer-import-file'))
  const first = h.importDraft(older)
  const second = h.importDraft(newer)
  newer.resolve()
  await second
  assert.equal(h.state.sheet.study.studyId, 'newer-import-file')
  const before = structuredClone(h.state)
  older.resolve()
  await first
  assert.deepEqual(h.state, before, 'stale earlier File.text completion is ignored')
  assert.equal(h.refs.importRequestRef.current, 2)
})

test('denied previous file after a newer selection must not erase a new success or warning', async () => {
  const h = harness(fixture('pre-existing-field'))
  const oldFile = delayedFile(fixture('older'))
  const newerFile = delayedFile(fixture('newer'))
  const first = h.importDraft(oldFile)
  const second = h.importDraft(newerFile)
  newerFile.resolve()
  await second
  assert.equal(h.state.pending.study.studyId, 'newer')
  assert.equal(h.state.status.kind, 'warning')
  oldFile.reject()
  await first
  assert.equal(h.state.pending.study.studyId, 'newer')
  assert.equal(h.state.status.kind, 'warning')
  assert.equal(h.state.sheet.study.studyId, 'pre-existing-field')
})

test('ordinary untouched empty draft still accepts a valid local JSON import immediately', async () => {
  const h = harness()
  const file = delayedFile()
  const started = h.importDraft(file)
  file.resolve()
  await started
  assert.equal(h.state.status.kind, 'success')
  assert.equal(h.state.pending, null)
  assert.deepEqual(h.state.sheet, fixture())
})

test('import request uses a real committed-sheet ref updated in a layout effect', () => {
  assert.match(source, /const latestSheetRef = useRef\(sheet\)/)
  assert.match(source, /const sheetRevisionRef = useRef\(0\)/)
  assert.match(source, /useLayoutEffect\(\(\) => \{[\s\S]*?latestSheetRef\.current = sheet[\s\S]*?sheetRevisionRef\.current \+= 1/)
  assert.match(source, /sheetRevisionRef\.current !== revisionAtStart/)
  assert.match(source, /observationSheetHasUserInput\(latestSheetRef\.current\)/)
  assert.doesNotMatch(source, /observationSheetHasUserInput\(sheet\)\)\s*\{\s*setPendingImport\(restored\)/)
  assert.match(source, /requestId !== importRequestRef\.current/)
  assert.doesNotMatch(source, /navigator\.clipboard|sendBeacon\(/)
})
