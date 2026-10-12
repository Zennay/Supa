import assert from 'node:assert/strict'
import test from 'node:test'

import { parseSchemaOrgProduct } from '../src/data/schemaOrgProduct.ts'

// Independent QA #1227 proof against frozen width repair #1232.
// No network access, genuine retailer prices, captured source pages or
// production source changes. Inputs are synthetic direct-API JSON-LD shapes.
const provenance = {
  supermarket: 'ah',
  kind: 'product',
  url: 'https://www.ah.nl/producten/product/qa-synthetic-no-capture',
  capturedAt: '2026-10-04T00:00:00.000Z',
  sha256: 'a'.repeat(64),
}

const fixture = () => ({
  '@type': 'Product',
  name: 'Synthetic plain rice',
  sku: 'qa-rice-001',
  offers: {
    '@type': 'Offer', price: '2.49', priceCurrency: 'EUR',
    availability: 'https://schema.org/InStock',
  },
})

function parse(input) {
  let output
  assert.doesNotThrow(() => { output = parseSchemaOrgProduct(input, provenance) })
  return output
}

test('QA #1227: reject >10k graph fanout before touching untrusted index zero', () => {
  const graph = Array.from({ length: 10_001 }, () => ({ '@type': 'WebPage' }))
  let indexedReads = 0
  Object.defineProperty(graph, '0', {
    configurable: true,
    get() { indexedReads++; throw Error('synthetic forbidden first index read') },
  })
  const result = parse({ '@graph': graph })
  assert.equal(result.type, 'abstain')
  assert.match(result.reason, /graph or types are malformed/)
  assert.equal(indexedReads, 0, 'oversized arrays must fail before scanning')
})

test('QA #1227: reject >64 declared schema types without inspecting elements', () => {
  const types = Array(65).fill('Thing')
  let indexedReads = 0
  Object.defineProperty(types, '0', {
    configurable: true,
    get() { indexedReads++; throw Error('synthetic type index getter') },
  })
  const result = parse({ ...fixture(), '@type': types })
  assert.equal(result.type, 'abstain')
  assert.match(result.reason, /graph or types are malformed/)
  assert.equal(indexedReads, 0)
})

test('QA #1227: reject >10k direct offers without reading the first entry', () => {
  const offers = Array.from({ length: 10_001 }, () => ({ '@type': 'Offer' }))
  let indexedReads = 0
  Object.defineProperty(offers, '0', {
    configurable: true,
    get() { indexedReads++; throw Error('synthetic offer index getter') },
  })
  const result = parse({ ...fixture(), offers })
  assert.equal(result.type, 'abstain')
  assert.match(result.reason, /offer types are malformed/)
  assert.equal(indexedReads, 0)
})

test('QA #1227: reject a cyclic nested graph while preserving a shared acyclic subgraph', () => {
  const cyclic = { '@type': 'WebPage' }
  cyclic['@graph'] = [cyclic]
  const refused = parse({ '@graph': [cyclic, fixture()] })
  assert.equal(refused.type, 'abstain')
  assert.match(refused.reason, /graph or types are malformed/)

  const shared = { '@type': 'WebPage', name: 'One shared static node' }
  const good = parse({
    '@graph': [
      { '@type': 'WebPage', '@graph': [shared] },
      { '@type': 'WebPage', '@graph': [shared] },
      fixture(),
    ],
  })
  assert.equal(good.type, 'observation')
  assert.equal(good.observation.currentPriceCents, 249)
  assert.equal(good.observation.sourceProductId, 'qa-rice-001')
  assert.equal(good.observation.availability, 'available')
})

test('QA #1227: exactly 64 legitimate type declarations still accept one Product', () => {
  const product = fixture()
  product['@type'] = [...Array(63).fill('Thing'), 'Product']
  const good = parse({ '@graph': [product] })
  assert.equal(good.type, 'observation')
  assert.equal(good.observation.currentPriceCents, 249)
  assert.equal(good.observation.currency, 'EUR')
})
