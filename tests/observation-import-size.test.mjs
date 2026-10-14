import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  MAX_OBSERVATION_DRAFT_FILE_BYTES,
  observationDraftFileSizeAllowed,
} from '../src/features/observation/observationDraftImport.ts'

test('M3 draft import accepts only bounded safe byte sizes', () => {
  assert.equal(observationDraftFileSizeAllowed(0), true)
  assert.equal(observationDraftFileSizeAllowed(16_384), true)
  assert.equal(
    observationDraftFileSizeAllowed(MAX_OBSERVATION_DRAFT_FILE_BYTES),
    true,
  )

  assert.equal(
    observationDraftFileSizeAllowed(MAX_OBSERVATION_DRAFT_FILE_BYTES + 1),
    false,
  )
  assert.equal(observationDraftFileSizeAllowed(-1), false)
  assert.equal(observationDraftFileSizeAllowed(1.5), false)
  assert.equal(observationDraftFileSizeAllowed(Number.NaN), false)
  assert.equal(observationDraftFileSizeAllowed(Number.POSITIVE_INFINITY), false)
  assert.equal(observationDraftFileSizeAllowed('1024'), false)
  assert.equal(observationDraftFileSizeAllowed(null), false)
})

test('M3 observation UI rejects an oversized draft before reading file contents', async () => {
  const source = await readFile(
    new URL('../src/features/observation/ObservationView.tsx', import.meta.url),
    'utf8',
  )
  const sizeGuard = source.indexOf('observationDraftFileSizeAllowed(file.size)')
  const fileRead = source.indexOf('await file.text()')

  assert.notEqual(sizeGuard, -1)
  assert.notEqual(fileRead, -1)
  assert.ok(sizeGuard < fileRead)
  assert.match(
    source,
    /Import geweigerd: het JSON-concept is groter dan 1 MB\./,
  )
})
