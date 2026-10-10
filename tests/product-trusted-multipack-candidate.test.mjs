import test from 'node:test'
import assert from 'node:assert/strict'
import { projectTrustedPackForMatching, projectTrustedObservationPack } from '../src/data/trustedMultipackCandidate.ts'
import { buildOneStoreBasket } from '../src/domain/basket.ts'

const observedPack = (rawText, amount, unit) => ({ rawText, amount, unit })

function basketForLitres(litres, pack) {
  return buildOneStoreBasket({
    store: { id: 'controlled', name: 'Controlled example' },
    plan: [{ day: 'ma', recipeId: 'water-meal' }],
    activeDays: ['ma'],
    recipes: [{
      id: 'water-meal',
      title: 'Controlled example',
      minutes: 5,
      servings: 1,
      estimatedCost: 0,
      tags: [],
      ingredients: [{
        id: 'water',
        query: 'water',
        label: 'Water',
        amount: litres,
        unit: 'l',
      }],
    }],
    products: [{
      id: 'water-pack',
      name: 'Water',
      storeId: 'controlled',
      available: true,
      priceCents: 199,
      ...pack,
    }],
  })
}

test('preserves 6 x 1 litre instead of silently undercounting as 1 litre', () => {
  const source = Object.freeze(observedPack('6 x 1 l', 1, 'l'))
  const candidate = projectTrustedPackForMatching(source)
  assert.deepEqual(candidate, { packAmount: 1, packUnit: 'l', packCount: 6 })
  assert.deepEqual(source, observedPack('6 x 1 l', 1, 'l'))

  const basket = basketForLitres(4, candidate)
  assert.equal(basket.unresolvedLineCount, 0)
  assert.equal(basket.lines[0].status, 'matched')
  assert.equal(basket.lines[0].packs, 1)
  assert.equal(basket.lines[0].pack.count, 6)
  assert.equal(basket.totalCents, 199)

  const twoPacks = basketForLitres(7, candidate)
  assert.equal(twoPacks.lines[0].packs, 2)
  assert.equal(twoPacks.totalCents, 398)
})

test('preserves ordinary 500g single packages and comma-decimal multipacks', () => {
  assert.deepEqual(projectTrustedPackForMatching(observedPack('500 g', 500, 'g')), {
    packAmount: 500,
    packUnit: 'g',
    packCount: 1,
  })
  assert.deepEqual(projectTrustedPackForMatching(observedPack('3 x 0,5 kg', 0.5, 'kg')), {
    packAmount: 0.5,
    packUnit: 'kg',
    packCount: 3,
  })
  assert.deepEqual(projectTrustedPackForMatching(observedPack('2 × 250 ml', 250, 'ml')), {
    packAmount: 250,
    packUnit: 'ml',
    packCount: 2,
  })
})

test('rejects source text contradictions and cannot silently infer a missing count', () => {
  for (const pack of [
    observedPack('6 x 1 l', 6, 'l'),
    observedPack('6 x 1 l', 1, 'ml'),
    observedPack('6 x 1 l', null, 'l'),
    observedPack('6 x 1 l', 1, 'unknown'),
    observedPack(null, 1, 'l'),
    observedPack('', 1, 'l'),
    observedPack('unknown', 1, 'l'),
    observedPack('6 x 1 l', 1, 'l'),
  ]) {
    if (pack.rawText === '6 x 1 l' && pack.amount === 1 && pack.unit === 'l') continue
    assert.equal(projectTrustedPackForMatching(pack), null)
  }
  assert.equal(projectTrustedPackForMatching({
    ...observedPack('6 x 1 l', 1, 'l'),
    count: 1,
  }), null)
  assert.deepEqual(projectTrustedPackForMatching({
    ...observedPack('6 x 1 l', 1, 'l'),
    count: 6,
  }), { packAmount: 1, packUnit: 'l', packCount: 6 })
})

test('fails closed on oversized counts, effective volume and malformed runtime inputs', () => {
  for (const pack of [
    null,
    undefined,
    7,
    [],
    observedPack('9007199254740992 x 1 l', 1, 'l'),
    observedPack('9007199254740991 x 2 l', 2, 'l'),
    observedPack('2 x 10000000000000 l', 10000000000000, 'l'),
    observedPack('0 x 1 l', 1, 'l'),
    observedPack('6 x 1 l', Number.NaN, 'l'),
    observedPack('6 x 1 l', 1, 'pack'),
  ]) {
    assert.equal(projectTrustedPackForMatching(pack), null)
  }
})

test('requires valid raw observation provenance before exposing a pack candidate', () => {
  const source = {
    supermarket: 'plus',
    sourceProductId: 'synthetic-water',
    name: 'Water',
    currentPriceCents: 199,
    currency: 'EUR',
    pack: observedPack('6 x 1 l', 1, 'l'),
    offer: null,
    availability: 'available',
    provenance: {
      supermarket: 'plus',
      kind: 'product',
      url: 'https://www.plus.nl/synthetic-water',
      capturedAt: '2026-10-10T12:00:00.000Z',
      sha256: 'a'.repeat(64),
    },
  }
  const snapshot = structuredClone(source)
  const candidate = projectTrustedObservationPack(source)
  assert.deepEqual(candidate, { packAmount: 1, packUnit: 'l', packCount: 6 })
  assert.deepEqual(source, snapshot)
  assert.equal(basketForLitres(4, candidate).totalCents, 199)

  for (const invalid of [
    { ...source, provenance: { ...source.provenance, supermarket: 'dekamarkt' } },
    { ...source, provenance: { ...source.provenance, url: 'https://invalid.example/water' } },
    { ...source, pack: { ...source.pack, count: 1 } },
    { ...source, currency: 'USD' },
    { ...source, currentPriceCents: 1.5 },
    { ...source, pack: { ...source.pack, rawText: null } },
    null,
    [],
  ]) {
    assert.equal(projectTrustedObservationPack(invalid), null)
  }
})
