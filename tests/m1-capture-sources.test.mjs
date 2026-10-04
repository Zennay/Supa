import assert from 'node:assert/strict'
import test from 'node:test'

import { SOURCES, validateSources } from '../scripts/m1-capture-sources.mjs'

test('M1 capture source set is bounded to two supermarkets and three page kinds', () => {
  assert.equal(SOURCES.length, 6)
  assert.deepEqual(
    [...new Set(SOURCES.map((source) => source.supermarket))].sort(),
    ['ah', 'plus'],
  )

  for (const supermarket of ['ah', 'plus']) {
    assert.deepEqual(
      SOURCES
        .filter((source) => source.supermarket === supermarket)
        .map((source) => source.kind)
        .sort(),
      ['catalog', 'offers', 'product'],
    )
  }

  assert.equal(validateSources(), true)
})

test('M1 capture rejects URLs outside the explicit allowlist', () => {
  assert.throws(
    () =>
      validateSources([
        {
          id: 'bad-source',
          supermarket: 'other',
          kind: 'product',
          url: 'https://example.com/product',
        },
      ]),
    /outside allowlist/,
  )
})
