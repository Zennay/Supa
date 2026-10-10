import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSchemaOrgProduct } from '../src/data/schemaOrgProduct.ts'

const provenance = {
  supermarket: 'ah',
  kind: 'product',
  url: 'https://www.ah.nl/producten/product/example',
  capturedAt: '2026-10-04T00:00:00.000Z',
  sha256: 'a'.repeat(64),
}

function assertAbstainsSafely(value, label) {
  let result
  assert.doesNotThrow(() => {
    result = parseSchemaOrgProduct(value, provenance)
  }, label)
  assert.equal(result.type, 'abstain', label)
  assert.equal(typeof result.reason, 'string', label)
  assert.ok(result.reason.length > 0 && result.reason.length < 240, label)
  assert.doesNotMatch(result.reason, /private-accessor-marker/i, label)
}

test('direct JSON-LD API does not throw on hostile Product property getters', () => {
  for (const field of ['name', 'offers', 'weight', 'sku']) {
    const product = { '@type': 'Product', name: 'Milk' }
    Object.defineProperty(product, field, {
      enumerable: true,
      get() { throw new Error('private-accessor-marker') },
    })
    assertAbstainsSafely(product, field)
  }
})

test('direct JSON-LD API does not throw on hostile nested Offer getters', () => {
  for (const field of ['price', 'priceCurrency', 'availability', 'priceSpecification']) {
    const offer = { '@type': 'Offer', price: '1.29', priceCurrency: 'EUR' }
    Object.defineProperty(offer, field, {
      enumerable: true,
      get() { throw new Error('private-accessor-marker') },
    })
    assertAbstainsSafely({ '@type': 'Product', name: 'Milk', offers: offer }, field)
  }
})

test('valid Product with one EUR Offer retains exact-cent price', () => {
  const result = parseSchemaOrgProduct({
    '@type': 'Product', name: 'Milk',
    offers: { '@type': 'Offer', price: '1.29', priceCurrency: 'EUR' },
  }, provenance)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 129)
})
