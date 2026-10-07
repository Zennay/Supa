import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const moneySource = readFileSync(
  new URL('../src/lib/money.ts', import.meta.url),
  'utf8',
)

test('legacy generic savings helper stays retired from the money API', () => {
  assert.doesNotMatch(moneySource, /\bexport\s+function\s+savings\b/)
  assert.doesNotMatch(moneySource, /\bfunction\s+savings\b/)
})
