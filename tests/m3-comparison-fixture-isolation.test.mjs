import assert from 'node:assert/strict'
import test from 'node:test'

import {
  m3BaselineProducts,
  m3BaselineStore,
  m3CandidateProducts,
  m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'
import { m2Products, m2Store } from '../src/data/m2Fixture.ts'

test('M3 baseline fixture does not alias M2 store or product objects', () => {
  assert.deepEqual(m3BaselineStore, m2Store)
  assert.notStrictEqual(m3BaselineStore, m2Store)

  assert.equal(m3BaselineProducts.length, m2Products.length + 1)
  for (let index = 0; index < m2Products.length; index += 1) {
    assert.deepEqual(m3BaselineProducts[index], m2Products[index])
    assert.notStrictEqual(m3BaselineProducts[index], m2Products[index])
  }
})

test('M3 comparison fixture binds every product to its declared store', () => {
  assert.equal(
    m3BaselineProducts.every(
      (product) => product.storeId === m3BaselineStore.id,
    ),
    true,
  )
  assert.equal(
    m3CandidateProducts.every(
      (product) => product.storeId === m3CandidateStore.id,
    ),
    true,
  )
})

test('M3 candidate fixture changes only candidate identity, store and price', () => {
  for (const m2Product of m2Products) {
    const candidate = m3CandidateProducts.find(
      (product) => product.id === `m3-b-${m2Product.id}`,
    )

    assert.ok(candidate)
    assert.deepEqual(candidate, {
      ...m2Product,
      id: `m3-b-${m2Product.id}`,
      storeId: m3CandidateStore.id,
      priceCents: Math.max(0, m2Product.priceCents - 10),
    })
  }

  const baselineGaram = m3BaselineProducts.find(
    (product) => product.id === `${m3BaselineStore.id}-garam-50`,
  )
  const candidateGaram = m3CandidateProducts.find(
    (product) => product.id === `${m3CandidateStore.id}-garam-50`,
  )

  assert.ok(baselineGaram)
  assert.ok(candidateGaram)
  assert.deepEqual(candidateGaram, {
    ...baselineGaram,
    id: `${m3CandidateStore.id}-garam-50`,
    storeId: m3CandidateStore.id,
  })
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

test('canonical M3 comparison fixture is immutable at exported boundaries', () => {
  assert.equal(Object.isFrozen(m3BaselineStore), true)
  assert.equal(Object.isFrozen(m3CandidateStore), true)
  assert.equal(Object.isFrozen(m3BaselineProducts), true)
  assert.equal(Object.isFrozen(m3CandidateProducts), true)
  assert.equal(Object.isFrozen(m3BaselineProducts[0]), true)
  assert.equal(Object.isFrozen(m3CandidateProducts[0]), true)

  assert.throws(() => {
    m3BaselineStore.name = 'Mutated baseline'
  }, TypeError)

  assert.throws(() => {
    m3CandidateStore.name = 'Mutated candidate'
  }, TypeError)

  assert.throws(() => {
    m3BaselineProducts[0].priceCents = 1
  }, TypeError)

  assert.throws(() => {
    m3CandidateProducts[0].priceCents = 1
  }, TypeError)

  assert.throws(() => {
    m3BaselineProducts.push(m3BaselineProducts[0])
  }, TypeError)

  assert.throws(() => {
    m3CandidateProducts.pop()
  }, TypeError)
})
