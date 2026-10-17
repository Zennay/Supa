import assert from 'node:assert/strict'
import test from 'node:test'
import { privateM3PackUnitPrice } from '../scripts/m3-private-pack-unit-price.mjs'

// Synthetic offline price metadata. packUnit must never be coerced to a
// property key: Symbol.toPrimitive can execute caller-controlled code.
function pack(packUnit) {
  return {
    status: 'known',
    pricePerPackageCents: 250,
    packAmount: 500,
    packUnit,
    itemsPerPackage: 1,
  }
}

test('M3 private unit-price rejects throwing Symbol.toPrimitive without invoking it', () => {
  let executions = 0
  const hostile = {
    [Symbol.toPrimitive]() {
      executions++
      throw new Error('PRIVATE_VALUE_DO_NOT_PRINT')
    },
  }
  assert.equal(privateM3PackUnitPrice(pack(hostile)), null)
  assert.equal(executions, 0)
})

test('M3 private unit-price rejects deceptive object unit without coercion', () => {
  let executions = 0
  const hostile = {
    [Symbol.toPrimitive]() {
      executions++
      return 'g'
    },
  }
  assert.equal(privateM3PackUnitPrice(pack(hostile)), null)
  assert.equal(executions, 0)
})

test('M3 private unit-price rejects boxed, numeric, and symbol units safely', () => {
  for (const unit of [new String('g'), 0, true, Symbol('g')]) {
    assert.equal(privateM3PackUnitPrice(pack(unit)), null)
  }
})

test('M3 private unit-price retains ordinary string-unit cents and zero-price behavior', () => {
  assert.deepEqual(privateM3PackUnitPrice(pack('g')), {
    cents: 50, basis: '100 g', approximate: false,
  })
  const free = Object.assign(Object.create(null), pack('ml'))
  free.pricePerPackageCents = 0
  assert.deepEqual(privateM3PackUnitPrice(free), {
    cents: 0, basis: '100 ml', approximate: false,
  })
})
