import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { removeObservationDraft } from '../src/features/observation/observationDraftPersistence.ts'

const source = await readFile(
  new URL('../src/features/observation/ObservationView.tsx', import.meta.url),
  'utf8',
)

test('draft removal reports durable storage success and failure explicitly', () => {
  const removed = []
  assert.equal(
    removeObservationDraft(
      () => ({
        removeItem(key) {
          removed.push(key)
        },
      }),
      'supa:m3:draft',
    ),
    true,
  )
  assert.deepEqual(removed, ['supa:m3:draft'])

  let recovered = false
  const { persistObservationDraft } = await import('../src/features/observation/observationDraftPersistence.ts')
  assert.equal(
    persistObservationDraft(
      () => ({ setItem() {} }),
      'supa:m3:draft',
      { clean: true },
      () => {
        recovered = true
      },
    ),
    true,
  )
  assert.equal(recovered, true)

  assert.equal(
    removeObservationDraft(
      () => {
        throw new Error('storage denied')
      },
      'supa:m3:draft',
    ),
    false,
  )

  assert.equal(
    removeObservationDraft(
      () => ({
        removeItem() {
          throw new Error('remove denied')
        },
      }),
      'supa:m3:draft',
    ),
    false,
  )
})

test('M3 reset never claims success when local draft removal fails', () => {
  assert.match(
    source,
    /const removed = removeObservationDraft\([\s\S]*?setDraftResetRemovalFailed\(!removed\)/,
  )
  assert.match(
    source,
    /setImportStatus\(\s*removed\s*\?\s*\{[\s\S]*?kind: 'success'[\s\S]*?: null/,
  )
  assert.match(
    source,
    /draftResetRemovalFailed\s*&&[\s\S]*?eerder opgeslagen lokale concept[\s\S]*?kon niet worden verwijderd/,
  )
})

test('a later successful persistence recovers the reset-removal warning', () => {
  assert.match(
    source,
    /persistObservationDraft\([\s\S]*?\(\) => setDraftResetRemovalFailed\(false\)/,
  )
  assert.match(
    source,
    /volgende succesvolle lokale opslag herstelt[\s\S]*?waarschuwing automatisch/,
  )
})
