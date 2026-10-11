import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeMoneyToCents, normalizeOfferLabel } from '../src/data/normalize.ts'

function dutchGroupedEuros(whole) {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

test('price ingestion round-trips deterministic cent values across Dutch and dot-decimal sources', () => {
  const examples = [0, 1, 9, 10, 99, 100, 101, 129, 999, 1000, 123456, 123456789]
  let state = 1729
  for (let index = 0; index < 256; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    examples.push(state)
  }

  for (const cents of examples) {
    const whole = Math.floor(cents / 100)
    const fraction = String(cents % 100).padStart(2, '0')
    const comma = `${dutchGroupedEuros(whole)},${fraction}`
    const dot = `${whole}.${fraction}`

    assert.equal(normalizeMoneyToCents(comma), cents, `Dutch ${comma}`)
    assert.equal(normalizeMoneyToCents(`€ ${comma}`), cents, `EUR ${comma}`)
    assert.equal(normalizeMoneyToCents(dot), cents, `dot ${dot}`)
  }
})

test('price ingestion rejects ambiguous grouping and precision without silently rewriting money', () => {
  for (const invalid of [
    '1.23,45',
    '12.34,56',
    '1.234.56',
    '1.234,567',
    '1 234,56',
    '1,2,3',
    '1.234,5.6',
    '1.234,56€',
    '+1.234,56',
    '1.234,56 extra',
  ]) {
    assert.equal(normalizeMoneyToCents(invalid), null, invalid)
  }
})

test('quantity and fixed-price offers use the same cent-exact price parser', () => {
  for (const [price, cents] of [
    ['0,99', 99],
    ['1,29', 129],
    ['12,34', 1234],
    ['1234.56', 123456],
  ]) {
    assert.deepEqual(normalizeOfferLabel(`2 voor ${price}`), {
      type: 'quantity_for_price',
      quantity: 2,
      totalPriceCents: cents,
    })
    assert.deepEqual(normalizeOfferLabel(`voor ${price}`), {
      type: 'fixed_price',
      priceCents: cents,
    })
  }

  for (const label of [
    '2 voor 1.234,56',
    'voor 1.234,56',
    '2 voor 1,234',
    'voor 1,234',
  ]) {
    assert.deepEqual(normalizeOfferLabel(label), {
      type: 'unknown',
      rawLabel: label,
    })
  }
})
