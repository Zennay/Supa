import assert from 'node:assert/strict'
import test from 'node:test'

import { projectTrustedObservationCatalogForBasket } from '../src/data/trustedMultipackStoreProduct.ts'

const store = Object.freeze({ id: 'controlled-plus', supermarket: 'plus' })
function observation(id = 'water-6pack') {
  return {
    supermarket: 'plus',
    sourceProductId: id,
    name: 'Water',
    currentPriceCents: 199,
    currency: 'EUR',
    pack: { rawText: '6 x 1 l', amount: 1, unit: 'l' },
    offer: null,
    availability: 'available',
    provenance: {
      supermarket: 'plus',
      kind: 'product',
      url: 'https://www.plus.nl/controlled-water',
      capturedAt: '2026-10-10T12:00:00Z',
      sha256: 'a'.repeat(64),
    },
  }
}

test('controlled batch requires all records valid and returns deterministic distinct store-scoped ids', () => {
  const source = [observation('water-z'), observation('water-a')]
  const before = structuredClone(source)
  const projected = projectTrustedObservationCatalogForBasket(source, store)
  assert.deepEqual(projected.map((row) => row.id), [
    'controlled-plus:water-a',
    'controlled-plus:water-z',
  ])
  assert.ok(projected.every((row) => row.packCount === 6 && row.priceCents === 199))
  assert.deepEqual(source, before)
  assert.deepEqual(store, { id: 'controlled-plus', supermarket: 'plus' })
})

test('controlled batch refuses malformed, unavailable, wrongly priced, or mixed-source rows instead of dropping them', () => {
  const baseline = observation()
  const invalid = [
    null,
    [],
    [baseline, { ...observation('other'), availability: 'unknown' }],
    [baseline, { ...observation('other'), currentPriceCents: null }],
    [baseline, { ...observation('other'), supermarket: 'dekamarkt' }],
    [baseline, { ...observation('other'), pack: { rawText: '6 x 1 l', amount: 1, unit: 'l', count: 1 } }],
    [baseline, null],
    [baseline, 42],
    [baseline, observation('water-6pack')],
    Array.from({ length: 5001 }, (_, index) => observation(`id-${index}`)),
  ]
  for (const source of invalid) {
    assert.equal(projectTrustedObservationCatalogForBasket(source, store), null)
  }
})

test('controlled batch does not infer retailer/store identity from one mixed record', () => {
  const first = observation('first')
  const second = observation('second')
  second.provenance.supermarket = 'dekamarkt'
  assert.equal(projectTrustedObservationCatalogForBasket([first, second], store), null)
  assert.equal(projectTrustedObservationCatalogForBasket([first], {
    id: 'controlled-deka',
    supermarket: 'dekamarkt',
  }), null)
})

test('controlled batch never mutates source or merges duplicate identities with conflicting prices', () => {
  const first = observation('same-id')
  const second = observation('same-id')
  second.currentPriceCents = 1
  const input = Object.freeze([Object.freeze(first), Object.freeze(second)])
  assert.equal(projectTrustedObservationCatalogForBasket(input, store), null)
  assert.equal(first.currentPriceCents, 199)
  assert.equal(second.currentPriceCents, 1)
})
