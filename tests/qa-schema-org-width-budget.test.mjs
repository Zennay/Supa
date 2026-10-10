import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSchemaOrgProduct } from '../src/data/schemaOrgProduct.ts'

// Deliberately synthetic. These tests assert bounded work, not time-based
// performance that would differ between hosted and the permanent VPS.
const provenance = {
  supermarket: 'ah',
  kind: 'product',
  url: 'https://www.ah.nl/producten/product/synthetic-width',
  capturedAt: '2026-10-04T00:00:00.000Z',
  sha256: 'a'.repeat(64),
}

const product = () => ({
  '@type': 'Product',
  name: 'Synthetic oats',
  offers: { '@type': 'Offer', price: '2.49', priceCurrency: 'EUR' },
})

function monitoredArray(length, fill) {
  const source = Array.from({ length }, () => fill)
  let inspectedIndexes = 0
  const proxy = new Proxy(source, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && /^(0|[1-9][0-9]*)$/.test(prop)) inspectedIndexes++
      return Reflect.get(target, prop, receiver)
    },
  })
  return { proxy, inspected: () => inspectedIndexes }
}

function assertRejectedWithoutScanning(input, monitor, title) {
  let result
  assert.doesNotThrow(() => { result = parseSchemaOrgProduct(input, provenance) }, title)
  assert.equal(result.type, 'abstain', title)
  assert.equal('observation' in result, false, title)
  assert.equal(monitor.inspected(), 0, title + ': oversized array must not be indexed')
}

test('oversized @graph arrays are refused before reading indexed elements', () => {
  const graph = monitoredArray(20_000, { '@type': 'WebPage' })
  assertRejectedWithoutScanning({ '@graph': graph.proxy }, graph, '@graph fanout')
})

test('oversized top-level JSON-LD arrays are refused before indexed access', () => {
  const root = monitoredArray(20_000, product())
  assertRejectedWithoutScanning(root.proxy, root, 'root fanout')
})

test('oversized @type arrays are refused before indexing potential types', () => {
  const types = monitoredArray(100, 'Product')
  assertRejectedWithoutScanning({ ...product(), '@type': types.proxy }, types, '@type fanout')
})

test('oversized Offer arrays are refused before reading prices or types', () => {
  const offers = monitoredArray(20_000, { '@type': 'Offer', price: '2.49', priceCurrency: 'EUR' })
  assertRejectedWithoutScanning({ ...product(), offers: offers.proxy }, offers, 'Offer fanout')
})

test('ordinary small @graph, @type and Offer arrays remain functional', () => {
  const result = parseSchemaOrgProduct({
    '@graph': [{
      ...product(),
      '@type': ['Product', 'Thing'],
      offers: [{ '@type': ['Offer'], price: '2.49', priceCurrency: 'EUR' }],
    }],
  }, provenance)
  assert.equal(result.type, 'observation')
  assert.equal(result.observation.currentPriceCents, 249)
})
