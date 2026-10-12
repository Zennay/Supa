import assert from 'node:assert/strict'
import test from 'node:test'

import { parseSchemaOrgProduct } from '../src/data/schemaOrgProduct.ts'

// Independent, direct-API QA acceptance for #2014 on frozen source proposal #2016.
// Synthetic JSON-LD only; never request, store or infer live retail observations.
const provenance = Object.freeze({
  supermarket: 'ah',
  kind: 'product',
  url: 'https://www.ah.nl/producten/product/qa-metadata-independent',
  capturedAt: '2026-10-04T00:00:00.000Z',
  sha256: 'e'.repeat(64),
})

function product() {
  return {
    '@type': 'Product',
    name: 'Synthetic yogurt',
    offers: {
      '@type': 'Offer',
      price: '2.49',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
    },
  }
}
function poisonOwnField(target, field) {
  Object.defineProperty(target, field, {
    enumerable: true,
    configurable: true,
    get() { throw Error(`synthetic getter unexpectedly consumed: ${field}`) },
  })
}
function parseSafely(value) {
  let result
  assert.doesNotThrow(() => { result = parseSchemaOrgProduct(value, provenance) })
  return result
}
function abstainsWithReason(value) {
  const result = parseSafely(value)
  assert.equal(result.type, 'abstain')
  assert.equal(typeof result.reason, 'string')
  assert.ok(result.reason.length > 0)
}

test('QA #2014: first available GTIN getter fails closed when SKU is absent', () => {
  const input = product()
  poisonOwnField(input, 'gtin13')
  abstainsWithReason(input)
})

test('QA #2014: nested Product.weight.value getter fails closed', () => {
  const input = product()
  input.weight = {}
  poisonOwnField(input.weight, 'value')
  abstainsWithReason(input)
})

test('QA #2014: revoked nested pack weight Proxy fails closed', () => {
  const input = product()
  const { proxy, revoke } = Proxy.revocable({ value: '500 g' }, {})
  input.weight = proxy
  revoke()
  abstainsWithReason(input)
})

test('QA #2014: offer date getter is never allowed to throw past parser', () => {
  for (const field of ['validFrom', 'priceValidUntil']) {
    const input = product()
    poisonOwnField(input.offers, field)
    abstainsWithReason(input)
  }
})

test('QA #2014: legitimate frozen source is read without mutation', () => {
  const input = Object.freeze({
    '@type': 'Product',
    name: 'Synthetic yogurt',
    sku: 'qa-1',
    weight: Object.freeze({ value: '500 g' }),
    offers: Object.freeze({
      '@type': 'Offer',
      price: '2.49',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock',
    }),
  })
  const result = parseSafely(input)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 249)
  assert.equal(result.observation.availability, 'available')
  assert.equal(result.observation.sourceProductId, 'qa-1')
  assert.equal(input.weight.value, '500 g')
})

test('QA #2014: ordinary missing optional metadata is not treated as a hostile getter', () => {
  const result = parseSafely(product())
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 249)
  assert.equal(result.observation.availability, 'available')
  assert.equal(result.observation.sourceProductId, null)
  assert.equal(result.observation.pack.unit, 'unknown')
})

test('QA #2014: pre-existing invalid offer date retains trust-validation explanation', () => {
  const input = product()
  input.offers.validFrom = 'not-an-ISO-date'
  const result = parseSafely(input)
  assert.equal(result.type, 'abstain')
  assert.match(result.reason, /failed trust validation/i)
  assert.match(result.reason, /validFrom/i)
})
