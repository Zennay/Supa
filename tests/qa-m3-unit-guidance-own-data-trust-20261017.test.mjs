import assert from 'node:assert/strict'
import test from 'node:test'

import { privateM3PackUnitPrice } from '../scripts/m3-private-pack-unit-price.mjs'

// Independent synthetic-only trust-boundary QA. Advisory normalized prices
// must not be produced from caller-supplied executable/inherited financial
// facts. No retailer traffic, personal data, rights changes or real prices.
const GOOD = Object.freeze({
  status: 'known',
  pricePerPackageCents: 800,
  packAmount: 500,
  packUnit: 'g',
  itemsPerPackage: 2,
})
const FIELDS = [
  'status', 'pricePerPackageCents', 'packAmount', 'packUnit',
  'itemsPerPackage',
]

test('M3 unit price preserves canonical own-data inputs and null-prototype data', () => {
  const expected = { cents: 80, basis: '100 g', approximate: false }
  assert.deepEqual(privateM3PackUnitPrice(GOOD), expected)
  assert.deepEqual(
    privateM3PackUnitPrice(Object.assign(Object.create(null), GOOD)),
    expected,
  )
  assert.deepEqual(GOOD, {
    status: 'known',
    pricePerPackageCents: 800,
    packAmount: 500,
    packUnit: 'g',
    itemsPerPackage: 2,
  })
})

for (const field of FIELDS) {
  test('M3 unit price refuses own getter for ' + field + ' without executing it', () => {
    let calls = 0
    const input = { ...GOOD }
    Object.defineProperty(input, field, {
      enumerable: true,
      configurable: true,
      get() {
        calls++
        return GOOD[field]
      },
    })
    let result
    assert.doesNotThrow(() => { result = privateM3PackUnitPrice(input) })
    assert.equal(calls, 0, 'caller getter must never execute')
    assert.equal(result, null, 'accessor-backed facts must not become money')
  })
}

for (const field of FIELDS) {
  test('M3 unit price refuses inherited authoritative ' + field, () => {
    const own = { ...GOOD }
    delete own[field]
    const input = Object.assign(Object.create({ [field]: GOOD[field] }), own)
    assert.equal(Object.hasOwn(input, field), false)
    assert.equal(privateM3PackUnitPrice(input), null,
      'prototype facts must not be promoted into trustworthy unit price')
  })
}

test('M3 unit price refuses a changing price getter instead of calculating post-check money', () => {
  const input = { ...GOOD }
  let calls = 0
  Object.defineProperty(input, 'pricePerPackageCents', {
    enumerable: true,
    get() {
      return ++calls === 1 ? 800 : 1600
    },
  })
  let result
  assert.doesNotThrow(() => { result = privateM3PackUnitPrice(input) })
  assert.equal(calls, 0, 'no price TOCTOU getter execution')
  assert.equal(result, null)
})

test('M3 unit price refuses a changing pack-count getter instead of post-check quantity', () => {
  const input = { ...GOOD }
  let calls = 0
  Object.defineProperty(input, 'itemsPerPackage', {
    enumerable: true,
    get() {
      return ++calls === 1 ? 2 : 20
    },
  })
  let result
  assert.doesNotThrow(() => { result = privateM3PackUnitPrice(input) })
  assert.equal(calls, 0, 'no count TOCTOU getter execution')
  assert.equal(result, null)
})

for (const field of ['status', 'pricePerPackageCents', 'packAmount', 'packUnit', 'itemsPerPackage']) {
  test('M3 unit price refuses throwing ' + field + ' getter without throwing', () => {
    const input = { ...GOOD }
    let calls = 0
    Object.defineProperty(input, field, {
      enumerable: true,
      get() {
        calls++
        throw new Error('PRIVATE_SYNTHETIC_CANARY_SHOULD_NOT_EXECUTE')
      },
    })
    let result
    assert.doesNotThrow(() => { result = privateM3PackUnitPrice(input) })
    assert.equal(calls, 0, 'no caller JavaScript execution')
    assert.equal(result, null, 'no derived financial guidance')
  })
}
