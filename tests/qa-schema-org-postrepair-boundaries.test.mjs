import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSchemaOrgProduct } from '../src/data/schemaOrgProduct.ts'

// Additional independent synthetic acceptance on the separate repair candidate.
const provenance = {
  supermarket: 'ah',
  kind: 'product',
  url: 'https://www.ah.nl/producten/product/synthetic-acceptance',
  capturedAt: '2026-10-04T00:00:00.000Z',
  sha256: 'a'.repeat(64),
}

function product() {
  return {
    '@type': ['Thing', 'Product'],
    name: 'Synthetic oats',
    offers: { '@type': ['Thing', 'Offer'], price: '2.49', priceCurrency: 'EUR' },
  }
}

function abstain(input, label) {
  let result
  assert.doesNotThrow(() => { result = parseSchemaOrgProduct(input, provenance) }, label)
  assert.equal(result.type, 'abstain', label)
  assert.equal(typeof result.reason, 'string', label)
  assert.ok(result.reason.length, label)
  assert.equal('observation' in result, false, label)
}

test('valid arrays of Schema.org type strings preserve one honest priced Product', () => {
  const result = parseSchemaOrgProduct(product(), provenance)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 249)
  assert.equal(result.observation.offer.offerPriceCents, 249)
})

test('a frozen, otherwise ordinary JSON-LD Product still parses', () => {
  const input = Object.freeze({
    '@type': 'Product',
    name: 'Synthetic oats',
    offers: Object.freeze({ '@type': 'Offer', price: '2.49', priceCurrency: 'EUR' }),
  })
  assert.equal(parseSchemaOrgProduct(input, provenance).type, 'observation')
})

test('revoked top-level Proxy is refused without propagating a TypeError', () => {
  const { proxy, revoke } = Proxy.revocable(product(), {})
  revoke()
  abstain(proxy, 'revoked root')
})

test('revoked @graph array is refused without propagating a TypeError', () => {
  const { proxy, revoke } = Proxy.revocable([product()], {})
  revoke()
  abstain({ '@graph': proxy }, 'revoked graph array')
})

test('revoked offers Proxy is refused without leaking a priced observation', () => {
  const { proxy, revoke } = Proxy.revocable(product().offers, {})
  revoke()
  abstain({ ...product(), offers: proxy }, 'revoked offers')
})

test('throwing @type accessor fails closed without letting errors escape', () => {
  const input = product()
  Object.defineProperty(input, '@type', { get() { throw Error('synthetic accessor sentinel') } })
  abstain(input, 'throwing type getter')
})

test('throwing graph accessor fails closed without letting errors escape', () => {
  const input = { '@type': 'WebPage' }
  Object.defineProperty(input, '@graph', { get() { throw Error('synthetic graph sentinel') } })
  abstain(input, 'throwing graph getter')
})

test('an acyclic graph exceeding the bounded visitor budget fails closed', () => {
  const root = { '@graph': [] }
  let current = root
  for (let i = 0; i < 10_100; i++) {
    const next = { '@graph': [] }
    current['@graph'].push(next)
    current = next
  }
  current['@graph'].push(product())
  abstain(root, 'bounded graph')
})

test('a shared acyclic Product path cannot be double-counted as one certain price', () => {
  const shared = { '@graph': [product()] }
  abstain({ '@graph': [shared, shared] }, 'shared Product is ambiguous')
})

test('bad Offer type mixed with a valid Offer cannot silently retain price', () => {
  const candidate = product()
  candidate.offers = [
    { '@type': 'Offer', price: '2.49', priceCurrency: 'EUR' },
    { '@type': [['Offer']], price: '2.49', priceCurrency: 'EUR' },
  ]
  abstain(candidate, 'mixed valid and malformed Offer types')
})
