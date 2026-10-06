import assert from 'node:assert/strict'
import test from 'node:test'

import {
  m2Products,
  m2Store,
} from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts,
  m3BaselineStore,
} from '../src/data/m3ComparisonFixture.ts'

test('M3 baseline store is an independent snapshot of the M2 store fixture', () => {
  assert.deepEqual(m3BaselineStore, m2Store)
  assert.notStrictEqual(m3BaselineStore, m2Store)
})

test('M3 baseline products do not alias canonical M2 product objects', () => {
  assert.equal(m3BaselineProducts.length, m2Products.length + 1)

  for (const [index, m2Product] of m2Products.entries()) {
    assert.deepEqual(m3BaselineProducts[index], m2Product)
    assert.notStrictEqual(m3BaselineProducts[index], m2Product)
  }
})
