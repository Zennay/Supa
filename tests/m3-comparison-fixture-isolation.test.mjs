import assert from 'node:assert/strict'
import test from 'node:test'

import {
  m3BaselineProducts,
  m3BaselineStore,
  m3CandidateProducts,
} from '../src/data/m3ComparisonFixture.ts'
import { m2Products, m2Store } from '../src/data/m2Fixture.ts'

test('M3 baseline fixture does not alias mutable M2 store or product objects', () => {
  assert.deepEqual(m3BaselineStore, m2Store)
  assert.notStrictEqual(m3BaselineStore, m2Store)

  assert.equal(m3BaselineProducts.length, m2Products.length + 1)
  for (let index = 0; index < m2Products.length; index += 1) {
    assert.deepEqual(m3BaselineProducts[index], m2Products[index])
    assert.notStrictEqual(m3BaselineProducts[index], m2Products[index])
  }
})

test('M3 candidate fixture remains independent from M2 product objects', () => {
  for (const m2Product of m2Products) {
    const candidate = m3CandidateProducts.find(
      (product) => product.id === `m3-b-${m2Product.id}`,
    )
    assert.ok(candidate)
    assert.notStrictEqual(candidate, m2Product)
    assert.equal(candidate.storeId, 'm3-candidate-store')
  }
})
