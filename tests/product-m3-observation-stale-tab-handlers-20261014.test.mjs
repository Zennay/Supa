import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import {
  observationDraftStorageStatus,
} from '../src/features/observation/observationDraftStorageGuard.ts'
import { OBSERVATION_DRAFT_STORAGE_KEY } from '../src/domain/m3ObservationSheet.ts'

const source = readFileSync(
  new URL('../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8',
)
const ast = ts.createSourceFile('ObservationView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function originalHandler(name, parameters) {
  let initializer
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) {
      assert.equal(initializer, undefined, name + ' should have only one runtime handler')
      initializer = node.initializer
    }
    ts.forEachChild(node, find)
  }
  find(ast)
  assert.ok(initializer && ts.isArrowFunction(initializer),
    'actual guard handler must exist: ' + name)
  const compiled = ts.transpileModule(
    'const guarded = ' + initializer.getText(ast) + ';',
    { fileName: 'M3GuardedHandler.ts', compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
    }, reportDiagnostics: true },
  )
  assert.deepEqual(compiled.diagnostics, [])
  return new Function(...parameters, compiled.outputText + '\nreturn guarded')
}

function controlled(kind, { changed = false, throws = false, resetSucceeds = true } = {}) {
  const raw = JSON.stringify({ schemaVersion: 1, marker: 'synthetic-original-private-22-rows' })
  let persisted = changed
    ? JSON.stringify({ schemaVersion: 1, marker: 'other-tab-new-private-data' })
    : raw
  const expectedDraftRawRef = { current: raw }
  let cleared = 0
  let resetArmed = true
  let recoveryResetArmed = true
  let conflict = false
  let removalFailure = false
  let status = null
  const browser = throws
    ? Object.defineProperty({}, 'localStorage', { get() { throw Error('denied') } })
    : { localStorage: { getItem(key) {
      assert.equal(key, OBSERVATION_DRAFT_STORAGE_KEY)
      return persisted
    } } }

  const callbacks = {
    clearDraft() {
      cleared++
      if (!resetSucceeds) return undefined
      persisted = null
      return true
    },
    clearUnrecognizedDraft() {
      cleared++
      if (!resetSucceeds) return undefined
      persisted = null
      return true
    },
  }
  const guarded = kind === 'ordinary'
    ? originalHandler('clearDraftWithConflictGuard', [
        'observationDraftStorageStatus', 'window', 'OBSERVATION_DRAFT_STORAGE_KEY',
        'expectedDraftRawRef', 'draftConflict', 'setDraftConflict',
        'setDraftResetRemovalFailed', 'setResetArmed', 'setImportStatus', 'clearDraft',
      ])(
        observationDraftStorageStatus, browser, OBSERVATION_DRAFT_STORAGE_KEY,
        expectedDraftRawRef, conflict, (value) => { conflict = value },
        (value) => { removalFailure = value }, (value) => { resetArmed = value },
        (value) => { status = value }, callbacks.clearDraft,
      )
    : originalHandler('clearUnrecognizedDraftWithConflictGuard', [
        'observationDraftStorageStatus', 'window', 'OBSERVATION_DRAFT_STORAGE_KEY',
        'expectedDraftRawRef', 'draftConflict', 'setDraftConflict',
        'setRecoveryResetArmed', 'setImportStatus', 'clearUnrecognizedDraft',
      ])(
        observationDraftStorageStatus, browser, OBSERVATION_DRAFT_STORAGE_KEY,
        expectedDraftRawRef, conflict, (value) => { conflict = value },
        (value) => { recoveryResetArmed = value }, (value) => { status = value },
        callbacks.clearUnrecognizedDraft,
      )
  return {
    execute: guarded,
    snapshot: () => ({
      raw, persisted, expected: expectedDraftRawRef.current,
      cleared, resetArmed, recoveryResetArmed, conflict, removalFailure, status,
    }),
  }
}

for (const kind of ['ordinary', 'unrecognized']) {
  test('real ' + kind + ' reset button refuses newer other-tab prices, keeps original state', () => {
    const run = controlled(kind, { changed: true })
    const before = run.snapshot()
    run.execute()
    const after = run.snapshot()
    assert.equal(after.cleared, 0, 'no destructive reset handler may run')
    assert.equal(after.persisted, before.persisted, 'other tab saved bytes must remain untouched')
    assert.equal(after.expected, before.expected, 'original tab snapshot remains pinned')
    assert.equal(after.conflict, true)
    assert.equal(after.status.kind, 'error')
    assert.doesNotMatch(after.status.message, /synthetic-original-private|other-tab-new-private/u)
    assert.equal(after[kind === 'ordinary' ? 'resetArmed' : 'recoveryResetArmed'], false)
  })

  test('real ' + kind + ' button never deletes evidence when storage is unreadable', () => {
    const run = controlled(kind, { throws: true })
    run.execute()
    const after = run.snapshot()
    assert.equal(after.cleared, 0)
    assert.match(after.persisted, /synthetic-original-private-22-rows/u)
    assert.equal(after.expected, after.raw)
    assert.equal(after.status.kind, 'error')
  })

  test('real ' + kind + ' button advances stored baseline only after confirmed delete', () => {
    const failed = controlled(kind, { resetSucceeds: false })
    failed.execute()
    assert.equal(failed.snapshot().cleared, 1)
    assert.notEqual(failed.snapshot().expected, null)
    assert.match(failed.snapshot().persisted, /synthetic-original-private-22-rows/u)
    const successful = controlled(kind)
    successful.execute()
    assert.equal(successful.snapshot().cleared, 1)
    assert.equal(successful.snapshot().persisted, null)
    assert.equal(successful.snapshot().expected, null)
  })
}

test('routed M3 form binds both destructive controls only to stale-tab-checked wrappers', () => {
  assert.match(source, /onClick=\{clearDraftWithConflictGuard\}/u)
  assert.match(source, /onClick=\{clearUnrecognizedDraftWithConflictGuard\}/u)
  assert.doesNotMatch(source, /onClick=\{clearDraft\}/u)
  assert.doesNotMatch(source, /onClick=\{clearUnrecognizedDraft\}/u)
})
