import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(
  new URL('../src/features/observation/ObservationView.tsx', import.meta.url),
  'utf8',
)

test('M3 reset persists the fresh sheet before claiming success', () => {
  const clearStart = source.indexOf('const clearDraft = () => {')
  const nextFunction = source.indexOf('const jumpToNextIncomplete', clearStart)
  const clearDraft = source.slice(clearStart, nextFunction)

  assert.notEqual(clearStart, -1)
  assert.notEqual(nextFunction, -1)
  assert.doesNotMatch(clearDraft, /localStorage\.removeItem/)
  assert.match(clearDraft, /const fresh = buildObservationSheet\(\)/)
  assert.match(
    clearDraft,
    /const persisted = persistObservationDraft\([\s\S]*?fresh,[\s\S]*?\)/,
  )
  assert.match(clearDraft, /setResetPersistenceFailed\(!persisted\)/)
  assert.match(
    clearDraft,
    /persisted[\s\S]*?kind: 'success'[\s\S]*?Lokaal concept gewist/,
  )
})

test('M3 reset failure warns that the old stored copy may remain', () => {
  assert.match(
    source,
    /resetPersistenceFailed[\s\S]*?eerder opgeslagen lokale kopie kon niet[\s\S]*?veilig worden overschreven/,
  )
  assert.match(
    source,
    /draftPersistenceFailed && !resetPersistenceFailed/,
  )
})
