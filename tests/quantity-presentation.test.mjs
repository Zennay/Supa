import assert from 'node:assert/strict'
import test from 'node:test'

import { quantityUnitLabelNl } from '../src/lib/quantityPresentation.ts'

test('localizes canonical piece units for Dutch singular and plural copy', () => {
  assert.equal(quantityUnitLabelNl('piece', 1), 'stuk')
  assert.equal(quantityUnitLabelNl('piece', 2), 'stuks')
  assert.equal(quantityUnitLabelNl('piece', 0), 'stuks')
  assert.equal(quantityUnitLabelNl('piece', null), 'stuks')
})

test('preserves non-piece canonical quantity units', () => {
  for (const unit of ['g', 'kg', 'ml', 'l', 'unknown']) {
    assert.equal(quantityUnitLabelNl(unit, 1), unit)
    assert.equal(quantityUnitLabelNl(unit, 2), unit)
  }
})
