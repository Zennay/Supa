import assert from 'node:assert/strict'
import test from 'node:test'

import {
  quantityUnitLabelNl,
  quantityUnitNameNl,
} from '../src/lib/quantityPresentation.ts'

test('localizes canonical quantity unit names without changing stored values', () => {
  assert.equal(quantityUnitNameNl('piece'), 'stuk')
  assert.equal(quantityUnitNameNl('unknown'), 'onbekend')

  for (const unit of ['g', 'kg', 'ml', 'l']) {
    assert.equal(quantityUnitNameNl(unit), unit)
  }
})

test('localizes canonical piece quantities for Dutch singular and plural copy', () => {
  assert.equal(quantityUnitLabelNl('piece', 1), 'stuk')
  assert.equal(quantityUnitLabelNl('piece', 2), 'stuks')
  assert.equal(quantityUnitLabelNl('piece', 0), 'stuks')
  assert.equal(quantityUnitLabelNl('piece', null), 'stuks')
})

test('preserves measurement-unit labels and localizes the unknown fallback', () => {
  for (const unit of ['g', 'kg', 'ml', 'l']) {
    assert.equal(quantityUnitLabelNl(unit, 1), unit)
    assert.equal(quantityUnitLabelNl(unit, 2), unit)
  }

  assert.equal(quantityUnitLabelNl('unknown', 1), 'onbekend')
  assert.equal(quantityUnitLabelNl('unknown', 2), 'onbekend')
})

test('fails closed unsupported runtime units instead of reflecting them into copy', () => {
  for (const unit of ['pcs', ' piece', 'piece ', 'unknown ', 'UNKNOWN', '', null, undefined, 1, Symbol('piece'), {}, []]) {
    assert.equal(quantityUnitNameNl(unit), 'onbekend')
    assert.equal(quantityUnitLabelNl(unit, 2), 'onbekend')
  }
})
