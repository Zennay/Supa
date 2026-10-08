import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SOURCES,
  readBoundedResponseBody,
  validateSources,
} from '../scripts/m1-capture-sources.mjs'

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


test('M1 bounded response reader preserves accepted UTF-8 content and byte count', async () => {
  const body = 'melk € 1,29'
  const result = await readBoundedResponseBody(new Response(body), 64)

  assert.equal(result.body, body)
  assert.equal(result.bytes, Buffer.byteLength(body, 'utf8'))
})

test('M1 bounded response reader cancels as soon as decoded bytes exceed the ceiling', async () => {
  let cancelled = false
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]))
      controller.enqueue(new Uint8Array([4, 5, 6]))
    },
    cancel() {
      cancelled = true
    },
  })

  await assert.rejects(
    () => readBoundedResponseBody(new Response(stream), 5),
    /Response exceeded 5 bytes while streaming/,
  )
  assert.equal(cancelled, true)
})

test('M1 bounded response reader rejects malformed byte ceilings', async () => {
  for (const maxBytes of [0, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      () => readBoundedResponseBody(new Response('ok'), maxBytes),
      /positive safe integer/,
    )
  }
})
