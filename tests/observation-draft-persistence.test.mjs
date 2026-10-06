import assert from 'node:assert/strict'
import test from 'node:test'

import { persistObservationDraft } from '../src/features/observation/observationDraftPersistence.ts'

test('M3 draft persistence writes the exact key and serialized draft', () => {
  const writes = []
  const storage = {
    setItem(key, value) {
      writes.push({ key, value })
    },
  }

  assert.equal(
    persistObservationDraft(() => storage, 'supa:m3-test', {
      study: { studyId: 'm3-week-001' },
    }),
    true,
  )
  assert.deepEqual(writes, [
    {
      key: 'supa:m3-test',
      value: '{"study":{"studyId":"m3-week-001"}}',
    },
  ])
})

test('M3 draft persistence fails closed when storage rejects the write', () => {
  const storage = {
    setItem() {
      throw new Error('quota denied')
    },
  }

  assert.equal(persistObservationDraft(() => storage, 'supa:m3-test', { ok: true }), false)
})

test('M3 draft persistence fails closed when serialization is impossible', () => {
  const circular = {}
  circular.self = circular
  let writeCount = 0
  const storage = {
    setItem() {
      writeCount += 1
    },
  }

  assert.equal(persistObservationDraft(() => storage, 'supa:m3-test', circular), false)
  assert.equal(writeCount, 0)
})

test('M3 draft persistence fails closed when storage access itself is denied', () => {
  assert.equal(
    persistObservationDraft(
      () => {
        throw new Error('storage access denied')
      },
      'supa:m3-test',
      { ok: true },
    ),
    false,
  )
})
