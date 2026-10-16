import test from 'node:test'
import assert from 'node:assert/strict'

import { makeRecord, packFromAmount, parsePack, totalPackQuantity } from '../scraper/lib/normalize.mjs'

// Product-owned boundary tests; immutable independent QA lives in its own file.
// All labels and SKU metadata below are synthetic, with no network or prices.
const UNKNOWN = { amount: null, unit: null, count: 1 }

test('invalid multipack count cannot fall through to a plausible single measured pack', () => {
  assert.deepEqual(parsePack('9007199254740993 x 250 g'), UNKNOWN)
  assert.deepEqual(parsePack('0 x 250 g'), UNKNOWN)
  assert.deepEqual(parsePack('9007199254740993 x 2 stuks'), UNKNOWN)
  assert.deepEqual(parsePack('9007199254740991 x 2 stuks'), UNKNOWN)
})

test('fractional units inside otherwise integral multipacks remain unknown', () => {
  assert.deepEqual(parsePack('2 x 1,5 eieren'), UNKNOWN)
  assert.deepEqual(parsePack('2 x 2.5 pcs'), UNKNOWN)
  assert.deepEqual(parsePack('2 x 3 stuks'), { amount: 3, unit: 'piece', count: 2 })
  assert.deepEqual(parsePack('2 x 250 g'), { amount: 250, unit: 'g', count: 2 })
})

test('pre-normalized piece pack cannot bypass physical integer acceptance', () => {
  for (const pack of [
    { amount: 1, unit: 'piece', count: 0.5 },
    { amount: 1.5, unit: 'piece', count: 2 },
    { amount: 1, unit: 'piece', count: Infinity },
    { amount: 1, unit: 'piece', count: Number.MAX_SAFE_INTEGER + 1 },
    { amount: 9007199254740991, unit: 'piece', count: 2 },
  ]) {
    const record = makeRecord({
      retailer: 'fictional-store',
      sourceId: 'synthetic-id',
      name: 'Synthetic unknown pack',
      pack,
      priceCents: 199,
    })
    assert.equal(record.packAmount, null)
    assert.equal(record.packUnit, null)
    assert.equal(record.packCount, 1)
    assert.equal(record.priceCents, 199, 'private price evidence is separate from pack identity')
  }
})

test('positive integral pre-normalized pieces retain their pack and quantity', () => {
  const record = makeRecord({
    retailer: 'fictional-store',
    sourceId: 'synthetic-id',
    name: 'Synthetic safe pieces',
    pack: { amount: 3, unit: 'piece', count: 2 },
    priceCents: 199,
  })
  assert.equal(record.packAmount, 3)
  assert.equal(record.packCount, 2)
  assert.equal(totalPackQuantity({ amount: record.packAmount, unit: record.packUnit, count: record.packCount }), 6)
})

test('typed non-piece decimal mass remains measurable and typed unsafe pieces are refused', () => {
  assert.deepEqual(packFromAmount('0,5', 'kg'), { amount: 500, unit: 'g', count: 1 })
  assert.deepEqual(packFromAmount('9007199254740993', 'stuks'), UNKNOWN)
  assert.deepEqual(packFromAmount('2,5', 'stuks'), UNKNOWN)
  assert.deepEqual(packFromAmount('4', 'stuks'), { amount: 1, unit: 'piece', count: 4 })
})
