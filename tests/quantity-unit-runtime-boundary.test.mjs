import assert from 'node:assert/strict'
import test from 'node:test'

import { quantityUnitLabelNl, quantityUnitNameNl } from '../src/lib/quantityPresentation.ts'

test('untrusted quantity units never reach Dutch labels verbatim', () => {
  const rejected = [
    'Piece', 'PIECE', 'pieces', 'pcs', 'stuk', 'stuks',
    'unknown ', ' unknown', 'g\n', 'kg\t', 'ml\u0000',
    '<script>alert(1)</script>', 'javascript:alert(1)',
    '\u200bpiece', 'piece\u200b', '\u00a0piece',
    true, false, 0, -1, Number.NaN, Number.POSITIVE_INFINITY,
    {}, { toString: () => 'piece' }, ['piece'],
  ]

  for (const unit of rejected) {
    assert.equal(quantityUnitNameNl(unit), 'onbekend')
    for (const amount of [null, -1, 0, 1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(quantityUnitLabelNl(unit, amount), 'onbekend')
    }
  }
})

test('recognized metric units remain canonical regardless of amount', () => {
  for (const unit of ['g', 'kg', 'ml', 'l']) {
    for (const amount of [null, -1, 0, 1, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(quantityUnitLabelNl(unit, amount), unit)
    }
  }
})

test('only exactly one piece is singular at the presentation boundary', () => {
  for (const amount of [null, -1, 0, 0.5, 1.5, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(quantityUnitLabelNl('piece', amount), 'stuks')
  }
  assert.equal(quantityUnitLabelNl('piece', 1), 'stuk')
})
