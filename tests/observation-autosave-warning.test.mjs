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
