import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/features/observation/ObservationView.tsx', import.meta.url),
  'utf8',
)

test('M3 observation UI surfaces autosave failure without reusing import status', () => {
  assert.match(
    source,
    /setDraftPersistenceFailed\(\s*!persistObservationDraft\(/,
  )
  assert.match(
    source,
    /draftPersistenceFailed\s*&&[\s\S]*?Automatisch bewaren is mislukt\./,
  )
  assert.match(
    source,
    /Bewaar dit concept handmatig als JSON[\s\S]*?voordat je deze pagina sluit\./,
  )
  assert.match(
    source,
    /className="observation-import-status is-warning" role="status"/,
  )
})

test('M3 status copy cannot promise persistence while local writes fail', () => {
  const statusStart = source.indexOf('data-observation-save-status="protected"')
  const failed = source.indexOf('data-observation-save-status="failed"')
  const normal = source.indexOf('data-observation-save-status="normal"')
  assert.ok(statusStart > 0 && failed > statusStart && normal > failed)
  const conditionalStart = source.lastIndexOf('draftRecoveryNeeded ? (', statusStart)
  const failureCondition = source.lastIndexOf('draftPersistenceFailed ? (', failed)
  assert.ok(conditionalStart > 0, 'protected drafts render their own warning')
  assert.ok(failureCondition > conditionalStart, 'write failure has its own state')
  assert.ok(normal > failureCondition, 'normal save promise is the final else only')
  const protectedCopy = source.slice(statusStart, failed)
  const failedCopy = source.slice(failed, normal)
  assert.match(protectedCopy, /Automatisch bewaren staat uit/)
  assert.match(failedCopy, /nieuwste invoer is niet lokaal opgeslagen/)
  assert.match(failedCopy, /Bewaar het[\\s\\S]*?JSON-concept handmatig/)
  assert.doesNotMatch(protectedCopy + failedCopy, /Je concept wordt automatisch lokaal/)
})
