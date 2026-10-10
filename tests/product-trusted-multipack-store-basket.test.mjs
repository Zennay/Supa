import assert from 'node:assert/strict'
import test from 'node:test'

import { projectTrustedObservationForBasket } from '../src/data/trustedMultipackStoreProduct.ts'
import { buildOneStoreBasket } from '../src/domain/basket.ts'

const store = Object.freeze({ id: 'synthetic-plus', supermarket: 'plus' })
const controlledObservation = () => ({
  supermarket: 'plus',
  sourceProductId: 'water-sixpack-001',
  name: 'Water',
  currentPriceCents: 199,
  currency: 'EUR',
  pack: { rawText: '6 x 1 l', amount: 1, unit: 'l' },
  offer: null,
  availability: 'available',
  provenance: {
    supermarket: 'plus',
    kind: 'product',
    url: 'https://www.plus.nl/synthetic-water',
    capturedAt: '2026-10-10T12:00:00Z',
    sha256: 'a'.repeat(64),
  },
})

function syntheticBasket(litres, products) {
  return buildOneStoreBasket({
    store: { id: store.id, name: 'Synthetic PLUS' },
    plan: [{ day: 'Mon', recipeId: 'water' }],
    activeDays: ['Mon'],
    recipes: [{
      id: 'water',
      title: 'Synthetic water-only example',
      minutes: 1,
      servings: 1,
      estimatedCost: 0,
      tags: [],
      ingredients: [{ id: 'water', query: 'water', label: 'Water', amount: litres, unit: 'l' }],
    }],
    products,
  })
}

test('controlled source observation becomes one immutable, count-accurate StoreProduct', () => {
  const observation = controlledObservation()
  const before = structuredClone(observation)
  const product = projectTrustedObservationForBasket(observation, store)

  assert.deepEqual(product, {
    id: 'synthetic-plus:water-sixpack-001',
    storeId: 'synthetic-plus',
    name: 'Water',
    priceCents: 199,
    available: true,
    packAmount: 1,
    packUnit: 'l',
    packCount: 6,
  })
  assert.deepEqual(observation, before)
  assert.deepEqual(store, { id: 'synthetic-plus', supermarket: 'plus' })

  const four = syntheticBasket(4, [product])
  assert.equal(four.matchedLineCount, 1)
  assert.equal(four.unresolvedLineCount, 0)
  assert.equal(four.lines[0].packs, 1)
  assert.equal(four.lines[0].pack.count, 6)
  assert.equal(four.totalCents, 199)

  const seven = syntheticBasket(7, [product])
  assert.equal(seven.matchedLineCount, 1)
  assert.equal(seven.lines[0].packs, 2)
  assert.equal(seven.totalCents, 398)
})

test('preserves one-pack cases and fractional multipacks with exact unit coverage', () => {
  const single = controlledObservation()
  single.sourceProductId = 'water-single'
  single.pack = { rawText: '1 l', amount: 1, unit: 'l' }
  assert.equal(projectTrustedObservationForBasket(single, store).packCount, 1)

  const fourBottles = controlledObservation()
  fourBottles.sourceProductId = 'water-four'
  fourBottles.pack = { rawText: '4 x 0,5 l', amount: 0.5, unit: 'l' }
  const projected = projectTrustedObservationForBasket(fourBottles, store)
  assert.equal(projected.packAmount, 0.5)
  assert.equal(projected.packCount, 4)
  assert.equal(syntheticBasket(1.5, [projected]).totalCents, 199)
  assert.equal(syntheticBasket(3, [projected]).totalCents, 398)
})

test('rejects unknown stock or money, instead of fabricating a purchasable basket row', () => {
  const valid = controlledObservation()
  for (const broken of [
    { ...valid, availability: 'unavailable' },
    { ...valid, availability: 'unknown' },
    { ...valid, currentPriceCents: null },
    { ...valid, currentPriceCents: -1 },
    { ...valid, currentPriceCents: 1.5 },
    { ...valid, currentPriceCents: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, currentPriceCents: Infinity },
    { ...valid, offer: { label: '2 + 1 gratis', mechanics: null, offerPriceCents: 199, originalPriceCents: 199, validFrom: null, validTo: null } },
  ]) {
    assert.equal(projectTrustedObservationForBasket(broken, store), null)
  }
})

test('rejects missing, ambiguous or corrupted source identity and provenance', () => {
  const valid = controlledObservation()
  for (const invalid of [
    { ...valid, supermarket: 'dekamarkt' },
    { ...valid, sourceProductId: null },
    { ...valid, sourceProductId: '' },
    { ...valid, sourceProductId: 'with spaces' },
    { ...valid, sourceProductId: '../private' },
    { ...valid, sourceProductId: 'A'.repeat(300) },
    { ...valid, provenance: { ...valid.provenance, supermarket: 'dekamarkt' } },
    { ...valid, provenance: { ...valid.provenance, url: 'https://not-plus.invalid/water' } },
    { ...valid, provenance: { ...valid.provenance, kind: 'catalog' } },
    { ...valid, provenance: { ...valid.provenance, kind: 'offers' } },
    { ...valid, provenance: { ...valid.provenance, sha256: 'wrong' } },
    { ...valid, pack: { rawText: '6 x 1 l', amount: 6, unit: 'l' } },
    { ...valid, pack: { rawText: '6 x 1 l', amount: 1, unit: 'l', count: 1 } },
    { ...valid, pack: { rawText: '9007199254740991 x 2 l', amount: 2, unit: 'l' } },
    { ...valid, name: ' ' },
    null, [], 'raw observation',
  ]) {
    assert.equal(projectTrustedObservationForBasket(invalid, store), null)
  }
})

test('rejects wrong store source or malformed target; does not infer retailer/store', () => {
  const valid = controlledObservation()
  for (const target of [
    null, undefined, [], 'synthetic-plus',
    { id: 'synthetic-plus', supermarket: 'dekamarkt' },
    { id: 'with spaces', supermarket: 'plus' },
    { id: '', supermarket: 'plus' },
    { id: 'synthetic-plus' },
  ]) {
    assert.equal(projectTrustedObservationForBasket(valid, target), null)
  }
})

test('cannot silently substitute another store catalog or include source private metadata in basket rows', () => {
  const observation = controlledObservation()
  observation.provenance.url = 'https://www.plus.nl/synthetic-water?private-token=synthetic'
  const product = projectTrustedObservationForBasket(observation, store)
  assert.equal(product.storeId, store.id)
  assert.deepEqual(Object.keys(product).sort(), [
    'available', 'id', 'name', 'packAmount', 'packCount', 'packUnit', 'priceCents', 'storeId',
  ].sort())
  assert.doesNotMatch(JSON.stringify(product), /private-token|capturedAt|sha256|provenance/)
  const other = buildOneStoreBasket({
    store: { id: 'synthetic-dekamarkt', name: 'Synthetic Deka' },
    plan: [{ day: 'Mon', recipeId: 'water' }],
    activeDays: ['Mon'],
    recipes: [{
      id: 'water', title: 'Controlled', minutes: 1, servings: 1, estimatedCost: 0,
      tags: [], ingredients: [{ id: 'water', query: 'water', label: 'Water', amount: 4, unit: 'l' }],
    }],
    products: [product],
  })
  assert.equal(other.unresolvedLineCount, 1)
  assert.equal(other.totalCents, 0)
})
