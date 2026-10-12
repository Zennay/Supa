import assert from 'node:assert/strict'
import test from 'node:test'

import { parseSchemaOrgProduct } from '../src/data/schemaOrgProduct.ts'

// QA #2006: independent synthetic acceptance stacked on frozen source proposal
// #2008. No retailer HTTP, no real observation or savings claim.
const provenance = {
  supermarket: 'ah',
  kind: 'product',
  url: 'https://www.ah.nl/producten/product/synthetic-price-spec-qa',
  capturedAt: '2026-10-04T00:00:00.000Z',
  sha256: 'c'.repeat(64),
}
const specification = (price = '1.39', currency = 'EUR') => ({
  '@type': 'UnitPriceSpecification',
  price,
  priceCurrency: currency,
})
const oneOffer = (priceSpecification) => ({
  '@type': 'Product',
  name: 'QA synthetic cereal',
  offers: { '@type': 'Offer', priceSpecification },
})
const manyOffers = (...offers) => ({
  '@type': 'Product',
  name: 'QA synthetic cereal',
  offers: offers.map((priceSpecification) => ({ '@type': 'Offer', priceSpecification })),
})
function safelyParse(product) {
  let result
  assert.doesNotThrow(() => { result = parseSchemaOrgProduct(product, provenance) })
  return result
}
function mustAbstain(result) {
  assert.equal(result.type, 'abstain')
  assert.equal(typeof result.reason, 'string')
  assert.ok(result.reason.length > 0)
}

test('QA #2006: reject 10001 nested entries before even indexed getter zero', () => {
  const values = Array(10001).fill(null)
  let reads = 0
  Object.defineProperty(values, '0', {
    configurable: true,
    get() { reads++; throw Error('QA forbidden index read') },
  })
  mustAbstain(safelyParse(oneOffer(values)))
  assert.equal(reads, 0)
})

test('QA #2006: fail closed on a throwing getter inside a small specification list', () => {
  const values = [specification()]
  Object.defineProperty(values, '0', {
    configurable: true,
    get() { throw Error('QA indexed property access denied') },
  })
  mustAbstain(safelyParse(oneOffer(values)))
})

test('QA #2006: reject aggregate 6000 + 4001 nested entries without reading the overflow offer', () => {
  const first = Array(6000).fill(null)
  const second = Array(4001).fill(null)
  let reads = 0
  Object.defineProperty(second, '0', {
    configurable: true,
    get() { reads++; throw Error('QA must reject before second-array traversal') },
  })
  mustAbstain(safelyParse(manyOffers(first, second)))
  assert.equal(reads, 0)
})

test('QA #2006: nested property getters fail closed rather than throwing across currency and price', () => {
  const offer = { '@type': 'Offer' }
  Object.defineProperty(offer, 'priceSpecification', {
    get() { throw Error('QA priceSpecification getter denied') },
  })
  mustAbstain(safelyParse({
    '@type': 'Product', name: 'QA synthetic cereal', offers: offer,
  }))

  const spec = { '@type': 'UnitPriceSpecification', priceCurrency: 'EUR' }
  Object.defineProperty(spec, 'price', {
    get() { throw Error('QA nested price getter denied') },
  })
  mustAbstain(safelyParse(oneOffer([spec])))

  const spec2 = { '@type': 'UnitPriceSpecification', price: '1.39' }
  Object.defineProperty(spec2, 'priceCurrency', {
    get() { throw Error('QA nested currency getter denied') },
  })
  mustAbstain(safelyParse(oneOffer([spec2])))
})

test('QA #2006: bounded EUR and exact aggregate limit still parse deterministically', () => {
  const small = safelyParse(oneOffer([specification()]))
  assert.equal(small.type, 'observation')
  assert.equal(small.observation.currentPriceCents, 139)
  assert.equal(small.observation.currency, 'EUR')

  // Ten thousand is an inclusive work limit, and absent entries are not prices.
  const exactlyLimit = safelyParse(oneOffer([
    specification(), ...Array(9999).fill(null),
  ]))
  assert.equal(exactlyLimit.type, 'observation')
  assert.equal(exactlyLimit.observation.currentPriceCents, 139)
})

test('QA #2006: conflicting numeric prices and foreign currencies never manufacture a value', () => {
  const conflictedPrices = safelyParse(oneOffer([
    specification('1.39'), specification('2.49'),
  ]))
  assert.equal(conflictedPrices.type, 'observation')
  assert.equal(conflictedPrices.observation.currentPriceCents, null)
  assert.equal(conflictedPrices.observation.offer, null)

  mustAbstain(safelyParse(oneOffer([specification('1.39', 'USD')])))
  mustAbstain(safelyParse(oneOffer([
    specification('1.39', 'EUR'), specification('1.39', 'USD'),
  ])))
})

test('QA #2006: source inputs remain unchanged after a successful read', () => {
  const values = Object.freeze([Object.freeze(specification())])
  const offer = Object.freeze({ '@type': 'Offer', priceSpecification: values })
  const product = Object.freeze({
    '@type': 'Product', name: 'QA synthetic cereal', offers: offer,
  })
  const result = safelyParse(product)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 139)
  assert.equal(values.length, 1)
  assert.equal(values[0].price, '1.39')
})
