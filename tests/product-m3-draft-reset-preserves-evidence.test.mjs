import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import { removeObservationDraft } from '../src/features/observation/observationDraftPersistence.ts'
import { OBSERVATION_DRAFT_STORAGE_KEY, buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

test('M3 removal failure cannot be treated as successful and must preserve real draft bytes', () => {
  const original = buildObservationSheet()
  original.study.studyId = 'private-field-collection'
  const evidence = JSON.stringify(original)
  let stored = evidence
  let writes = 0
  const storage = {
    removeItem() { throw new Error('storage policy denies removal') },
    setItem(_key, value) { writes += 1; stored = value },
  }
  const removed = removeObservationDraft(() => storage, OBSERVATION_DRAFT_STORAGE_KEY)
  assert.equal(removed, false)
  assert.equal(stored, evidence)
  assert.equal(writes, 0, 'a rejected removal must not write an empty template')
})

test('actual M3 clear handler returns on remove failure before resetting any React state', async () => {
  const source = await readFile(
    new URL('../src/features/observation/ObservationView.tsx', import.meta.url),
    'utf8',
  )
  const file = ts.createSourceFile('ObservationView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let clearDraft
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'clearDraft') {
      clearDraft = node.initializer
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(clearDraft && ts.isArrowFunction(clearDraft))
  const statements = clearDraft.body.statements
  const indexOf = (part) => statements.findIndex((stmt) => stmt.getText(file).includes(part))
  const guardIndex = statements.findIndex((stmt) =>
    ts.isIfStatement(stmt) && stmt.expression.getText(file) === '!removed')
  const resetIndex = indexOf('setSheet(buildObservationSheet())')
  const removalIndex = indexOf('const removed = removeObservationDraft(')
  assert.ok(removalIndex >= 0 && guardIndex > removalIndex && resetIndex > guardIndex,
    'durable remove must be checked before the form is cleared')
  const guard = statements[guardIndex]
  assert.ok(ts.isIfStatement(guard) && ts.isBlock(guard.thenStatement))
  const failure = guard.thenStatement.statements
  assert.ok(failure.some(ts.isReturnStatement),
    'storage-denied branch must return before subsequent clearing/autosave')
  assert.match(guard.getText(file), /setImportStatus\(\{/)
  assert.match(guard.getText(file), /kind: 'error'/)
  assert.match(guard.getText(file), /ingevulde meting is behouden/)
  assert.doesNotMatch(guard.getText(file), /setSheet\(|setPendingImport\(null\)/)
  assert.match(statements[resetIndex].getText(file), /setSheet\(buildObservationSheet\(\)\)/)

  const original = buildObservationSheet()
  assert.equal(original.baseline.lines.length, 11)
  assert.equal(original.candidate.lines.length, 11)
  assert.equal(original.evidenceStatus, 'collection-template-not-evidence')
})
