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

test('parses one conservative schema.org Product observation', () => {
  const result = parseSchemaOrgProduct(
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Halfvolle melk',
      sku: 'wi1525',
      offers: {
        '@type': 'Offer',
        price: '1.29',
        priceCurrency: 'EUR',
        availability: 'https://schema.org/InStock',
        priceValidUntil: '2026-10-05',
      },
    },
    provenance,
  )

  assert.equal(result.type, 'observation')
  assert.equal(result.observation.name, 'Halfvolle melk')
  assert.equal(result.observation.sourceProductId, 'wi1525')
  assert.equal(result.observation.currentPriceCents, 129)
  assert.equal(result.observation.availability, 'available')
  assert.equal(result.observation.pack.unit, 'unknown')
  assert.equal(result.observation.offer.offerPriceCents, 129)
})

test('finds a Product inside an @graph', () => {
  const result = parseSchemaOrgProduct(
    {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'Product page' },
        {
          '@type': 'Product',
          name: 'Basmati rijst',
          gtin13: '8712345678901',
          offers: {
            '@type': 'Offer',
            price: 2.49,
            priceCurrency: 'EUR',
            availability: 'https://schema.org/OutOfStock',
          },
        },
      ],
    },
    provenance,
  )

  assert.equal(result.type, 'observation')
  assert.equal(result.observation.sourceProductId, '8712345678901')
  assert.equal(result.observation.currentPriceCents, 249)
  assert.equal(result.observation.availability, 'unavailable')
})

test('abstains when multiple product nodes make the page ambiguous', () => {
  const result = parseSchemaOrgProduct(
    [
      { '@type': 'Product', name: 'A' },
      { '@type': 'Product', name: 'B' },
    ],
    provenance,
  )

  assert.deepEqual(result, {
    type: 'abstain',
    reason: 'multiple Product JSON-LD nodes are ambiguous',
  })
})

test('abstains on conflicting offer prices instead of guessing', () => {
  const result = parseSchemaOrgProduct(
    {
      '@type': 'Product',
      name: 'Milk',
      offers: [
        { '@type': 'Offer', price: '1.29', priceCurrency: 'EUR' },
        { '@type': 'Offer', price: '1.49', priceCurrency: 'EUR' },
      ],
    },
    provenance,
  )

  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, null)
  assert.equal(result.observation.offer, null)
})

test('abstains on explicit non-EUR product pricing', () => {
  const result = parseSchemaOrgProduct(
    {
      '@type': 'Product',
      name: 'Milk',
      offers: {
        '@type': 'Offer',
        price: '1.29',
        priceCurrency: 'GBP',
      },
    },
    provenance,
  )

  assert.deepEqual(result, {
    type: 'abstain',
    reason: 'Product JSON-LD currency is not EUR: GBP',
  })
})

test('abstains when a priced offer has no explicit currency', () => {
  const result = parseSchemaOrgProduct(
    {
      '@type': 'Product',
      name: 'Milk',
      offers: {
        '@type': 'Offer',
        price: '1.29',
      },
    },
    provenance,
  )

  assert.deepEqual(result, {
    type: 'abstain',
    reason: 'Product JSON-LD priced offer has no explicit currency',
  })
})

test('malformed external JSON-LD abstains instead of throwing through the parser contract', () => {
  const result = parseSchemaOrgProduct(
    {
      '@type': 'Product',
      name: 'Milk',
      offers: {
        '@type': 'Offer',
        price: '1.29',
        priceCurrency: 'EUR',
        validFrom: 'not-a-date',
      },
    },
    provenance,
  )

  assert.equal(result.type, 'abstain')
  assert.match(result.reason, /failed trust validation/)
  assert.match(result.reason, /validFrom/)
})


test('unsafe numeric schema.org product identifiers are not stringified', () => {
  const result = parseSchemaOrgProduct(
    {
      '@type': 'Product',
      name: 'Milk',
      sku: Number.MAX_SAFE_INTEGER + 1,
      offers: {
        '@type': 'Offer',
        price: '1.29',
        priceCurrency: 'EUR',
      },
    },
    provenance,
  )

  assert.equal(result.type, 'observation')
  assert.equal(result.observation.sourceProductId, null)
  assert.equal(result.observation.currentPriceCents, 129)
})
