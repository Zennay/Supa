import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

import {
  OBSERVATION_DRAFT_STORAGE_KEY,
  buildObservationSheet,
  observationSheetHasUserInput,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'
import {
  persistObservationDraft,
  removeObservationDraft,
} from '../src/features/observation/observationDraftPersistence.ts'

// Independently execute the *real* React screen's reset handler in a controlled
// harness, not a hand-written approximation of its intended branches.
// The store and every observed line below are synthetic; no human field data.
const source = readFileSync(
  new URL('../src/features/observation/ObservationView.tsx', import.meta.url),
  'utf8',
)
const file = ts.createSourceFile(
  'ObservationView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
)
let initializer
function locate(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'clearDraft') {
    assert.equal(initializer, undefined, 'screen must have one reset handler')
    initializer = node.initializer
  }
  ts.forEachChild(node, locate)
}
locate(file)
assert.ok(initializer && ts.isArrowFunction(initializer),
  'test must evaluate the actual source handler')
const compileHandler = new Function(
  'sheet', 'resetArmed', 'setResetArmed', 'setImportStatus',
  'removeObservationDraft', 'setDraftResetRemovalFailed', 'window',
  'OBSERVATION_DRAFT_STORAGE_KEY', 'setSheet', 'buildObservationSheet',
  'setPendingImport', 'observationSheetHasUserInput',
  'return (' + initializer.getText(file) + ')',
)

function syntheticHumanLikeDraft() {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-reset-test-001',
    participantKey: 'fictional-participant-only',
    population: 'synthetic',
    region: 'fake-Leiden',
    weekStart: '2026-10-05',
    priceContext: 'in-store',
  })
  for (const [side, retailer] of [['baseline', 'PLUS'], ['candidate', 'DekaMarkt']]) {
    sheet[side].store = { id: 'test-' + side, name: retailer + ' fictief' }
    sheet[side].evidenceId = 'synthetic-' + side
    sheet[side].provenanceNote = 'controlled QA only'
    sheet[side].observedAt = '2026-10-05T12:00:00Z'
    for (const line of sheet[side].lines) line.observedProduct.available = false
  }
  assert.equal(sheet.baseline.lines.length, 11)
  assert.equal(sheet.candidate.lines.length, 11)
  assert.equal(observationSheetHasUserInput(sheet), true)
  return sheet
}

function controlledReset({ removeThrows = false, accessThrows = false } = {}) {
  const firstSheet = syntheticHumanLikeDraft()
  const original = JSON.stringify(firstSheet)
  let stored = original
  let armed = false
  let state = firstSheet
  let pendingImport = { kind: 'synthetic-pending' }
  let removalFailed = false
  let importStatus = null
  const events = []
  let writes = 0
  let removes = 0
  const storage = {
    removeItem(key) {
      assert.equal(key, OBSERVATION_DRAFT_STORAGE_KEY)
      removes++
      if (removeThrows) throw new Error('denied removal')
      stored = null
    },
    setItem(key, value) {
      assert.equal(key, OBSERVATION_DRAFT_STORAGE_KEY)
      writes++
      stored = value
    },
  }
  const browser = accessThrows
    ? Object.defineProperty({}, 'localStorage', {
      get() { throw new Error('blocked browser storage') },
    })
    : { localStorage: storage }

  function click() {
    const handler = compileHandler(
      state, armed,
      value => { events.push('arm'); armed = value },
      value => { events.push('status'); importStatus = value },
      removeObservationDraft,
      value => { events.push('remove-warning'); removalFailed = value },
      browser,
      OBSERVATION_DRAFT_STORAGE_KEY,
      value => { events.push('change-sheet'); state = value },
      buildObservationSheet,
      value => { events.push('clear-import'); pendingImport = value },
      observationSheetHasUserInput,
    )
    handler()
  }

  return {
    click,
    original,
    firstSheet,
    events,
    storage,
    snapshot: () => ({
      armed, state, pendingImport, removalFailed, importStatus,
      stored, writes, removes,
    }),
  }
}

for (const kind of ['removeItem throws', 'localStorage getter throws']) {
  test('independent M3 QA: second confirmation of ' + kind +
    ' preserves all 22 source observations and import state', () => {
    const run = controlledReset({
      removeThrows: kind === 'removeItem throws',
      accessThrows: kind === 'localStorage getter throws',
    })
    run.click()
    let result = run.snapshot()
    assert.equal(result.armed, true)
    assert.equal(result.removes, 0, 'first click only arms protected reset')
    assert.equal(result.writes, 0)
    assert.equal(result.importStatus.kind, 'warning')
    assert.strictEqual(result.state, run.firstSheet)

    run.click()
    result = run.snapshot()
    assert.equal(result.armed, false)
    assert.equal(result.removalFailed, true)
    assert.equal(result.importStatus.kind, 'error')
    assert.match(result.importStatus.message, /ingevulde meting is behouden/)
    assert.strictEqual(result.state, run.firstSheet,
      'failed removal may never reset live React evidence state')
    assert.deepEqual(result.pendingImport, { kind: 'synthetic-pending' },
      'failed removal must not wipe separately staged human import')
    assert.equal(result.stored, run.original,
      'localStorage bytes remain identical, not a blank template')
    assert.equal(result.writes, 0)
    assert.equal(run.events.includes('change-sheet'), false)
    assert.equal(run.events.includes('clear-import'), false)
    assert.deepEqual(JSON.parse(result.stored), run.firstSheet)
    assert.equal(restoreObservationSheetDraft(result.stored).baseline.lines.length, 11)
    assert.equal(restoreObservationSheetDraft(result.stored).candidate.lines.length, 11)
  })
}

test('independent M3 QA: successful two-step reset removes durable evidence first', () => {
  const run = controlledReset()
  run.click()
  assert.equal(run.snapshot().removes, 0)
  run.click()
  const result = run.snapshot()
  assert.equal(result.removes, 1)
  assert.equal(result.stored, null, 'persisted observation removed before UI reset')
  assert.equal(result.writes, 0)
  assert.equal(result.armed, false)
  assert.equal(result.removalFailed, false)
  assert.equal(result.importStatus.kind, 'success')
  assert.equal(result.pendingImport, null)
  assert.notStrictEqual(result.state, run.firstSheet)
  assert.deepEqual(result.state, buildObservationSheet(),
    'a successful reset creates exactly the canonical blank template')
  assert.ok(run.events.indexOf('remove-warning') < run.events.indexOf('change-sheet'),
    'reset may update the sheet only after remove result has been checked')
})

test('independent M3 QA: deny removal while writes remain permitted never swaps the durable study', () => {
  const run = controlledReset({ removeThrows: true })
  run.click()
  run.click()
  const before = run.snapshot()
  assert.equal(before.removes, 1)
  assert.equal(before.writes, 0)
  assert.equal(before.stored, run.original)
  // Explicitly model the later autosave effect. Even if a write can succeed,
  // no empty sheet may have been installed in component state by failed reset.
  assert.equal(persistObservationDraft(
    () => run.storage, OBSERVATION_DRAFT_STORAGE_KEY, before.state,
  ), true)
  const after = run.snapshot()
  assert.equal(after.stored, run.original,
    'future autosaves may not replace a retained human observation with blanks')
  assert.equal(after.writes, 1)
  assert.strictEqual(after.state, run.firstSheet)
})
