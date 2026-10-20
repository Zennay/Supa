import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { validateBenchmarkCaseIdentity } from '../scripts/m1-run-matching-benchmark.mjs'

const fixtureUrl = new URL('../fixtures/matching/benchmark.v1.json', import.meta.url)

test('canonical matching benchmark has unique path-safe case identities', async () => {
  const cases = JSON.parse(await readFile(fixtureUrl, 'utf8'))
  assert.doesNotThrow(() => validateBenchmarkCaseIdentity(cases))
})

test('matching benchmark rejects duplicate case identities', () => {
  assert.throws(
    () =>
      validateBenchmarkCaseIdentity([
        { id: 'same-case' },
        { id: 'same-case' },
      ]),
    /duplicate case id: same-case/,
  )
})

test('matching benchmark rejects unsafe or missing case identities', () => {
  for (const id of ['', '../case', 'case/child', null]) {
    assert.throws(
      () => validateBenchmarkCaseIdentity([{ id }]),
      /has an unsafe id/,
      String(id),
    )
  }
})

test('matching benchmark cannot become valid with no evidence cases', () => {
  assert.throws(
    () => validateBenchmarkCaseIdentity([]),
    /must contain at least one case/,
  )
})
