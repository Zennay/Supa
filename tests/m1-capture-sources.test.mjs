import assert from 'node:assert/strict'
import test from 'node:test'

import { SOURCES, validateSources } from '../scripts/m1-capture-sources.mjs'

test('M1 capture source set is bounded to two supermarkets and three page kinds', () => {
  assert.equal(SOURCES.length, 6)
  assert.deepEqual(
    [...new Set(SOURCES.map((source) => source.supermarket))].sort(),
    ['dekamarkt', 'plus'],
  )

  for (const supermarket of ['dekamarkt', 'plus']) {
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

test('M1 capture rejects supermarkets outside the current technical pair', () => {
  assert.throws(
    () =>
      validateSources([
        {
          id: 'historical-ah-source',
          supermarket: 'ah',
          kind: 'product',
          url: 'https://www.ah.nl/producten',
        },
      ]),
    /Unsupported supermarket/,
  )
})

test('M1 capture rejects a URL whose host does not match its supermarket', () => {
  assert.throws(
    () =>
      validateSources([
        {
          id: 'mislabeled-source',
          supermarket: 'dekamarkt',
          kind: 'product',
          url: 'https://www.plus.nl/producten',
        },
      ]),
    /does not match supermarket allowlist/,
  )
})

test('M1 capture rejects non-HTTPS supermarket URLs', () => {
  assert.throws(
    () =>
      validateSources([
        {
          id: 'insecure-source',
          supermarket: 'plus',
          kind: 'offers',
          url: 'http://www.plus.nl/aanbiedingen',
        },
      ]),
    /does not match supermarket allowlist/,
  )
})

test('M1 capture rejects unsupported source kinds', () => {
  assert.throws(
    () =>
      validateSources([
        {
          id: 'wrong-kind',
          supermarket: 'dekamarkt',
          kind: 'search',
          url: 'https://www.dekamarkt.nl/producten/zuivel-kaas/melk-karnemelk',
        },
      ]),
    /Unsupported source kind/,
  )
})
