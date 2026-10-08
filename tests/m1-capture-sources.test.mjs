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


test('M1 capture rejects unsafe source ids before they can become file names', () => {
  assert.throws(
    () =>
      validateSources([
        {
          id: '../plus-product',
          supermarket: 'plus',
          kind: 'product',
          url: 'https://www.plus.nl/producten',
        },
      ]),
    /Invalid or duplicate source id/,
  )
})

test('M1 capture rejects non-default HTTPS ports', () => {
  assert.throws(
    () =>
      validateSources([
        {
          id: 'plus-alt-port',
          supermarket: 'plus',
          kind: 'catalog',
          url: 'https://www.plus.nl:444/producten',
        },
      ]),
    /does not match supermarket allowlist/,
  )
})

test('M1 capture rejects credential-bearing allowlisted URLs', () => {
  assert.throws(
    () =>
      validateSources([
        {
          id: 'plus-credential-url',
          supermarket: 'plus',
          kind: 'catalog',
          url: 'https://user:secret@www.plus.nl/producten',
        },
      ]),
    /does not match supermarket allowlist/,
  )
})


test('M1 capture validator rejects empty, incomplete and malformed source containers', () => {
  assert.throws(
    () => validateSources([]),
    /must contain exactly 6 sources/,
  )
  assert.throws(
    () => validateSources(SOURCES.slice(0, 5)),
    /must contain exactly 6 sources/,
  )
  assert.throws(
    () => validateSources(null),
    /must contain exactly 6 sources/,
  )

  const malformed = [...SOURCES]
  malformed[0] = null
  assert.throws(
    () => validateSources(malformed),
    /Invalid source entry/,
  )
})

test('M1 capture validator rejects duplicate retailer-kind pairs even with unique ids', () => {
  const duplicatePair = SOURCES.map((source) => ({ ...source }))
  const plusOffers = duplicatePair.find(
    (source) => source.supermarket === 'plus' && source.kind === 'offers',
  )
  const dekaOffersIndex = duplicatePair.findIndex(
    (source) => source.supermarket === 'dekamarkt' && source.kind === 'offers',
  )

  duplicatePair[dekaOffersIndex] = {
    ...plusOffers,
    id: 'plus-offers-duplicate-pair',
  }

  assert.throws(
    () => validateSources(duplicatePair),
    /Invalid or duplicate source matrix entry: plus:offers/,
  )
})

test('M1 capture validator accepts the complete matrix independent of source order', () => {
  assert.equal(validateSources([...SOURCES].reverse()), true)
})
