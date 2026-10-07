import assert from 'node:assert/strict'
import test from 'node:test'

import {
  quantityUnitLabelNl,
  quantityUnitNameNl,
} from '../src/lib/quantityPresentation.ts'

test('localizes the canonical piece unit name without changing its stored value', () => {
  assert.equal(quantityUnitNameNl('piece'), 'stuk')

  for (const unit of ['g', 'kg', 'ml', 'l', 'unknown']) {
    assert.equal(quantityUnitNameNl(unit), unit)
  }
})

test('localizes canonical piece quantities for Dutch singular and plural copy', () => {
  assert.equal(quantityUnitLabelNl('piece', 1), 'stuk')
  assert.equal(quantityUnitLabelNl('piece', 2), 'stuks')
  assert.equal(quantityUnitLabelNl('piece', 0), 'stuks')
  assert.equal(quantityUnitLabelNl('piece', null), 'stuks')
})

test('preserves non-piece canonical quantity labels', () => {
  for (const unit of ['g', 'kg', 'ml', 'l', 'unknown']) {
    assert.equal(quantityUnitLabelNl(unit, 1), unit)
    assert.equal(quantityUnitLabelNl(unit, 2), unit)
  }
})

test('fails closed unsupported runtime units instead of reflecting them into copy', () => {
  for (const unit of ['pcs', ' piece', 'piece ', '', null, undefined, 1, {}, []]) {
    assert.equal(quantityUnitNameNl(unit), 'unknown')
    assert.equal(quantityUnitLabelNl(unit, 2), 'unknown')
  }
})
