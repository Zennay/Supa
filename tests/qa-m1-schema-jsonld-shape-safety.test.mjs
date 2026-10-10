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

function expectAbstainWithoutThrow(value, label) {
  let result
  assert.doesNotThrow(() => {
    result = parseSchemaOrgProduct(value, provenance)
  }, label)
  assert.equal(result.type, 'abstain', label)
  assert.equal(typeof result.reason, 'string', label)
  assert.ok(result.reason.length > 0 && result.reason.length < 240, label)
}

test('JSON-LD malformed type objects abstain without coercion exceptions', () => {
  const malformedType = JSON.parse('{"toString":null}')
  expectAbstainWithoutThrow({ '@type': malformedType, name: 'Unknown' }, 'object type')
  expectAbstainWithoutThrow({ '@type': ['Product', malformedType], name: 'Unknown' }, 'mixed type array')
  expectAbstainWithoutThrow({
    '@graph': [{ '@type': { toString: null } }, { '@type': ['Offer', { toString: null }] }],
  }, 'graph type')
})

test('cyclic JSON-LD graph structures fail closed instead of recursing forever', () => {
  const root = []
  root.push(root)
  expectAbstainWithoutThrow(root, 'cyclic root array')

  const graph = { '@graph': [] }
  graph['@graph'].push(graph)
  expectAbstainWithoutThrow(graph, 'cyclic graph object')

  const mixed = { '@graph': [{ '@type': 'Product', name: 'Milk' }] }
  mixed['@graph'].push(mixed)
  expectAbstainWithoutThrow(mixed, 'cyclic graph with Product')
})

test('deeply nested graphs abstain within a bounded traversal', () => {
  let value = { '@type': 'Product', name: 'Milk' }
  for (let depth = 0; depth < 11000; depth += 1) {
    value = { '@graph': [value] }
  }
  expectAbstainWithoutThrow(value, 'excessive graph depth')
})

test('ordinary priced Product remains an exact-cent observation', () => {
  const result = parseSchemaOrgProduct({
    '@type': 'Product',
    name: 'Milk',
    offers: { '@type': 'Offer', price: '1.29', priceCurrency: 'EUR' },
  }, provenance)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 129)
  assert.equal(result.observation.currency, 'EUR')
})
