import test from 'node:test'
import assert from 'node:assert/strict'

import { schemaOrgPrices, recordFromSchemaOrg } from '../scraper/adapters/schemaorg.mjs'

// Invented offline pricing inputs only, no retailer HTTP or exchange rates.
test('nested inherited USD is not a EUR PriceSpecification', () => {
  assert.deepEqual(schemaOrgPrices({
    priceCurrency: 'USD',
    priceSpecification: { price: '1.49' },
  }), { priceCents: null, promoPriceCents: null })
})

test('valid nested EUR overrides an explicitly foreign parent only when tagged independently', () => {
  assert.deepEqual(schemaOrgPrices({
    priceCurrency: 'USD',
    price: '0.99',
    priceSpecification: { priceCurrency: 'EUR', price: '2.49' },
  }), { priceCents: 249, promoPriceCents: null })
})

test('explicit unsupported currencies inside strike-through cannot create false discount', () => {
  assert.deepEqual(schemaOrgPrices({
    price: '3.99', priceCurrency: 'EUR',
    priceSpecification: [
      { price: '8.99', priceType: 'https://schema.org/StrikethroughPrice', priceCurrency: 'GBP' },
    ],
  }), { priceCents: 399, promoPriceCents: null })
})

test('mixed multi-offers reject non-EUR discount and preserve EUR only', () => {
  assert.deepEqual(schemaOrgPrices([
    { price: '2.99', priceCurrency: 'EUR' },
    { price: '0.01', priceCurrency: 'JPY' },
    { price: '3.99', priceCurrency: 'eur' },
  ]), { priceCents: 299, promoPriceCents: null })
})

test('explicit invalid currency types fail closed without coercing to EUR', () => {
  for (const priceCurrency of [0, false, {}, [], 'GB P', 'USD']) {
    const record = recordFromSchemaOrg({
      name: 'Imaginary bag', sku: 'synthetic',
      offers: { price: '2.99', priceCurrency },
    }, { retailer: 'fictional', url: 'https://example.test/p/1' })
    assert.equal(record.priceCents, null)
    assert.equal(record.promoPriceCents, null)
  }
})
