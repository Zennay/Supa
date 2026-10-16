import test from 'node:test'
import assert from 'node:assert/strict'

import { makeRecord, packFromAmount, parsePack } from '../scraper/lib/normalize.mjs'

// Independent QA. Retail payable packs of individual physical units must
// contain a positive *safe integer* count. Ambiguous fraction-of-piece or
// unrepresentable counts must not be promoted to a comparable package.
// Synthetic scalar inputs only: no live product, source grant or HTTP.
const UNKNOWN = { amount: null, unit: null, count: 1 }

test('ordinary integer piece packs remain exact', () => {
  assert.deepEqual(parsePack('4 stuks'), { amount: 1, unit: 'piece', count: 4 })
  assert.deepEqual(parsePack('12 eieren'), { amount: 1, unit: 'piece', count: 12 })
  assert.deepEqual(packFromAmount('4', 'st'), { amount: 1, unit: 'piece', count: 4 })
  assert.deepEqual(packFromAmount(12, 'pcs'), { amount: 1, unit: 'piece', count: 12 })
  assert.deepEqual(parsePack('0,5 kg'), { amount: 500, unit: 'g', count: 1 })
})

for (const [input, note] of [
  ['1,5 st', 'fractional piece'],
  ['2.5 pcs', 'fractional piece with dot'],
  ['0,5 eieren', 'fractional egg'],
  ['9007199254740993 stuks', 'unsafe integer greater than JS MAX_SAFE_INTEGER'],
]) {
  test(`untrusted parsed ${note} must not mint an exact physical pack`, () => {
    assert.deepEqual(parsePack(input), UNKNOWN)
  })
}

for (const [input, note] of [
  [1.5, 'fractional primitive count'],
  ['2,5', 'fractional string count'],
  ['9007199254740993', 'unsafe integer count string'],
]) {
  test(`untrusted source numeric ${note} must abstain from a piece pack`, () => {
    assert.deepEqual(packFromAmount(input, 'st'), UNKNOWN)
  })
}

test('record normalization does not promote fractional piece packs to canonical facts', () => {
  const record = makeRecord({
    retailer: 'fictional-store',
    sourceId: 'fictional-egg-carton',
    name: 'Fictional egg package',
    packText: '1,5 eieren',
    priceCents: 400,
    availability: 'unknown',
  })
  assert.equal(record.packAmount, null)
  assert.equal(record.packUnit, null)
  assert.equal(record.priceCents, 400, 'raw fictional archive price is a separate field')
})
