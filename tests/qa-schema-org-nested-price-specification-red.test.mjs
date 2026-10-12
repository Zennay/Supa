import assert from 'node:assert/strict'
import test from 'node:test'

import { parseSchemaOrgProduct } from '../src/data/schemaOrgProduct.ts'

// QA #2006: intentional synthetic expected RED on frozen parser #1232.
// A nested priceSpecification array is not governed by the outer offers/graph
// breadth limits, and currently reaches unguarded Array.prototype.filter.
// This test changes no source and never contacts a retailer.
const provenance = {
  supermarket: 'ah',
  kind: 'product',
  url: 'https://www.ah.nl/producten/product/synthetic-qa-only',
  capturedAt: '2026-10-04T00:00:00.000Z',
  sha256: 'a'.repeat(64),
}
const withSpecifications = (priceSpecification) => ({
  '@type': 'Product',
  name: 'Synthetic cereal QA only',
  offers: { '@type': 'Offer', priceSpecification },
})

test('QA #2006 expected RED: throwing nested specification getter must abstain, never throw', () => {
  const specs = [{
    price: '1.39', priceCurrency: 'EUR',
  }]
  Object.defineProperty(specs, '0', {
    configurable: true,
    get() { throw Error('synthetic hostile priceSpecification getter') },
  })

  let result
  assert.doesNotThrow(() => {
    result = parseSchemaOrgProduct(withSpecifications(specs), provenance)
  })
  assert.equal(result.type, 'abstain')
})

test('QA #2006 expected RED: oversized nested specification list must fail before indexed reads', () => {
  const specs = Array.from({ length: 10_001 }, () => ({ price: '1.39', priceCurrency: 'EUR' }))
  let reads = 0
  Object.defineProperty(specs, '0', {
    configurable: true,
    get() { reads++; throw Error('unexpected nested array traversal') },
  })

  let result
  assert.doesNotThrow(() => {
    result = parseSchemaOrgProduct(withSpecifications(specs), provenance)
  })
  assert.equal(result.type, 'abstain')
  assert.equal(reads, 0, 'reject wide nested arrays before accessing their elements')
})

test('QA #2006 positive: a bounded explicit EUR priceSpecification remains trustworthy', () => {
  let result
  assert.doesNotThrow(() => {
    result = parseSchemaOrgProduct(withSpecifications([{
      '@type': 'UnitPriceSpecification',
      price: '1.39',
      priceCurrency: 'EUR',
    }]), provenance)
  })
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 139)
  assert.equal(result.observation.currency, 'EUR')
})
