import assert from 'node:assert/strict'
import test from 'node:test'

import {
  observationPackAmount,
  observationPackCount,
} from '../src/features/observation/observationNumericInput.ts'

test('M3 pack amount parser keeps finite editable values and rejects non-finite input', () => {
  assert.equal(observationPackAmount('600'), 600)
  assert.equal(observationPackAmount('0'), 0)
  assert.equal(observationPackAmount('-1'), -1)
  assert.equal(observationPackAmount('2.5'), 2.5)
  assert.equal(observationPackAmount('1e3'), 1000)
  assert.equal(observationPackAmount(''), null)
  assert.equal(observationPackAmount('   '), null)
  assert.equal(observationPackAmount('1e309'), null)
  assert.equal(observationPackAmount('Infinity'), null)
  assert.equal(observationPackAmount('NaN'), null)
})

test('M3 pack amount parser rejects malformed runtime value types', () => {
  for (const malformed of [null, undefined, 600, {}, [], true]) {
    assert.equal(observationPackAmount(malformed), null)
  }
})

test('M3 pack count parser preserves current truncation/default semantics safely', () => {
  assert.equal(observationPackCount('2'), 2)
  assert.equal(observationPackCount('2.9'), 2)
  assert.equal(observationPackCount('1e2'), 100)
  assert.equal(observationPackCount('1'), 1)
  assert.equal(observationPackCount('0'), 1)
  assert.equal(observationPackCount('-4'), 1)
  assert.equal(observationPackCount(''), 1)
  assert.equal(observationPackCount('1e309'), 1)
  assert.equal(observationPackCount('9007199254740992'), 1)
})

test('M3 pack count parser rejects malformed runtime value types', () => {
  for (const malformed of [null, undefined, 2, {}, [], true]) {
    assert.equal(observationPackCount(malformed), 1)
  }
})
