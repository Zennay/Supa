import assert from 'node:assert/strict'
import test from 'node:test'

import {
  m3BaselineProducts,
  m3BaselineStore,
  m3CandidateProducts,
  m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

function assertCanonicalText(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`)
  assert.ok(value.length > 0, `${label} must not be empty`)
  assert.equal(value, value.trim(), `${label} must be canonical`)
}

function assertControlledProducts(products, store, label) {
  assert.ok(products.length > 0, `${label} fixture must contain products`)
  assert.equal(new Set(products.map((product) => product.id)).size, products.length)

  for (const product of products) {
    assertCanonicalText(product.id, `${label} product id`)
    assertCanonicalText(product.name, `${label} product name`)
    assert.equal(product.storeId, store.id, `${product.id} must bind to ${store.id}`)
    assert.equal(typeof product.available, 'boolean')
    assert.ok(Number.isSafeInteger(product.priceCents))
    assert.ok(product.priceCents >= 0)

    assert.ok(Number.isFinite(product.packAmount))
    assert.ok(product.packAmount > 0)
    assert.notEqual(product.packUnit, 'unknown')

    if (product.packCount !== undefined && product.packCount !== null) {
      assert.ok(Number.isSafeInteger(product.packCount))
      assert.ok(product.packCount > 0)
    }
  }
}

test('controlled M3 fixture keeps distinct canonical store identities', () => {
  assertCanonicalText(m3BaselineStore.id, 'baseline store id')
  assertCanonicalText(m3CandidateStore.id, 'candidate store id')
  assertCanonicalText(m3BaselineStore.name, 'baseline store name')
  assertCanonicalText(m3CandidateStore.name, 'candidate store name')
  assert.notEqual(m3BaselineStore.id, m3CandidateStore.id)
})

test('controlled M3 fixture binds every product exactly to its owning store', () => {
  assertControlledProducts(m3BaselineProducts, m3BaselineStore, 'baseline')
  assertControlledProducts(m3CandidateProducts, m3CandidateStore, 'candidate')
})

test('controlled M3 fixture product identities do not collide across stores', () => {
  const baselineIds = new Set(m3BaselineProducts.map((product) => product.id))

  for (const candidate of m3CandidateProducts) {
    assert.equal(
      baselineIds.has(candidate.id),
      false,
      `product id must remain store-distinct: ${candidate.id}`,
    )
  }
})
