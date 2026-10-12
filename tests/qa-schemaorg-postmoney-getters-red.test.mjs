import assert from 'node:assert/strict'
import test from 'node:test'

import { parseSchemaOrgProduct } from '../src/data/schemaOrgProduct.ts'

// QA #2014: synthetic direct-API getter failures on frozen staged parser #2009.
// No retailer requests, field data, real price assertions, or production changes.
const provenance = {
  supermarket: 'ah',
  kind: 'product',
  url: 'https://www.ah.nl/producten/product/synthetic-qa-getters-only',
  capturedAt: '2026-10-04T00:00:00.000Z',
  sha256: 'd'.repeat(64),
}

const normalProduct = () => ({
  '@type': 'Product',
  name: 'Synthetic cereal',
  sku: 'qa-only',
  weight: { value: '500 g' },
  offers: {
    '@type': 'Offer',
    price: '1.39',
    priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
    validFrom: '2026-10-03',
    priceValidUntil: '2026-10-17',
  },
})

function throwOnRead(object, key) {
  Object.defineProperty(object, key, {
    configurable: true,
    enumerable: true,
    get() { throw new Error('QA hostile getter: ' + key) },
  })
}

const cases = [
  ['Product.name', (product) => throwOnRead(product, 'name')],
  ['Product.sku', (product) => throwOnRead(product, 'sku')],
  ['Product.weight', (product) => throwOnRead(product, 'weight')],
  ['Offer.availability', (product) => throwOnRead(product.offers, 'availability')],
  ['Offer.validFrom', (product) => throwOnRead(product.offers, 'validFrom')],
  ['Offer.priceValidUntil', (product) => throwOnRead(product.offers, 'priceValidUntil')],
]

for (const [field, poison] of cases) {
  test(`QA #2014 expected RED: throwing ${field} metadata getter must abstain safely`, () => {
    const product = normalProduct()
    poison(product)
    let result
    assert.doesNotThrow(() => {
      result = parseSchemaOrgProduct(product, provenance)
    }, `${field} must not escape the parser`)
    assert.equal(result.type, 'abstain')
    assert.match(result.reason, /malformed|unusable|failed/i)
  })
}

test('QA #2014 positive: normal exact-EUR source metadata still produces a bounded observation', () => {
  const input = normalProduct()
  const result = parseSchemaOrgProduct(input, provenance)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 139)
  assert.equal(result.observation.currency, 'EUR')
  assert.equal(result.observation.availability, 'available')
  assert.equal(result.observation.name, 'Synthetic cereal')
  assert.equal(result.observation.sourceProductId, 'qa-only')
})
