import assert from 'node:assert/strict'
import test from 'node:test'

import { parseSchemaOrgProduct } from '../src/data/schemaOrgProduct.ts'

// Synthetic trust-boundary inputs only; none are retailer observations.
const provenance = Object.freeze({
  supermarket: 'ah',
  kind: 'product',
  url: 'https://www.ah.nl/producten/product/synthetic-example',
  capturedAt: '2026-10-04T00:00:00.000Z',
  sha256: 'a'.repeat(64),
})

const product = () => ({
  '@type': 'Product',
  name: 'Synthetic milk',
  offers: { '@type': 'Offer', price: '1.29', priceCurrency: 'EUR' },
})

function abstainsWithoutThrow(value, label) {
  let result
  assert.doesNotThrow(() => { result = parseSchemaOrgProduct(value, provenance) }, label)
  assert.equal(result?.type, 'abstain', label)
  assert.equal(typeof result.reason, 'string', label)
  assert.ok(result.reason.length > 0, label)
  assert.equal('observation' in result, false, label)
}

test('malformed object @type without a callable toString never crashes', () => {
  const malformed = Object.create(null)
  abstainsWithoutThrow({ ...product(), '@type': malformed }, 'null-prototype @type')
  abstainsWithoutThrow({ ...product(), '@type': { toString: null } }, 'noncallable @type')
})

test('malformed @type array members never coerce to strings', () => {
  abstainsWithoutThrow(
    { ...product(), '@type': ['Product', { toString: null }] },
    'mixed Product and hostile object type',
  )
  abstainsWithoutThrow(
    { ...product(), '@type': [['Product']] },
    'nested type array should not be interpreted as Product',
  )
})

test('malformed offer @type cannot throw or produce priced observations', () => {
  const hostile = { ...product(), offers: { ...product().offers, '@type': { toString: null } } }
  abstainsWithoutThrow(hostile, 'malformed Offer @type')
  abstainsWithoutThrow(
    { ...product(), offers: { ...product().offers, '@type': [['Offer']] } },
    'nested offer type array',
  )
})

test('self-referential root @graph abstains, even when Product is present', () => {
  const root = { '@graph': [product()] }
  root['@graph'].push(root)
  abstainsWithoutThrow(root, 'self-referential graph')
})

test('mutually cyclic @graph objects abstain instead of recursing', () => {
  const root = { '@graph': [product()] }
  const second = { '@graph': [root] }
  root['@graph'].push(second)
  abstainsWithoutThrow(root, 'mutual graph cycle')
})

test('self-referential top-level JSON-LD array abstains', () => {
  const root = [product()]
  root.push(root)
  abstainsWithoutThrow(root, 'array self cycle')
})

test('graph with a cycle but no Product still abstains without a thrown RangeError', () => {
  const a = { '@type': 'WebPage', '@graph': [] }
  const b = { '@type': 'BreadcrumbList', '@graph': [a] }
  a['@graph'].push(b)
  abstainsWithoutThrow(a, 'no Product cyclic graph')
})

test('ordinary direct Product remains parsed with unchanged conservative price', () => {
  const result = parseSchemaOrgProduct(product(), provenance)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.name, 'Synthetic milk')
  assert.equal(result.observation.currentPriceCents, 129)
  assert.equal(result.observation.offer.offerPriceCents, 129)
})

test('ordinary acyclic nested @graph still finds a single Product', () => {
  const result = parseSchemaOrgProduct(
    { '@type': 'WebPage', '@graph': [{ '@type': 'ItemList', '@graph': [product()] }] },
    provenance,
  )
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 129)
})

test('two distinct Products continue to abstain as ambiguous', () => {
  abstainsWithoutThrow([product(), product()], 'multiple Product nodes')
})
