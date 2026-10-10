import assert from 'node:assert/strict'
import test from 'node:test'

import { projectTrustedObservationForBasket } from '../src/data/trustedMultipackStoreProduct.ts'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

// This integration uses only synthetic fixture cents and hypothetical raw
// observations. Comparator arithmetic is NOT real retailer savings evidence.
const plus = { id: 'synthetic-plus', name: 'Synthetic PLUS' }
const deka = { id: 'synthetic-deka', name: 'Synthetic DekaMarkt' }

function controlledProducts(store, { withRice = true } = {}) {
  const products = m2Products
    .filter((product) => withRice || product.id !== 'basmati-1kg')
    .map((product) => ({
      ...product,
      id: `${store.id}-${product.id}`,
      storeId: store.id,
    }))
  products.push({
    id: `${store.id}-garam-50`,
    storeId: store.id,
    name: 'Garam masala 50 g',
    packAmount: 50,
    packUnit: 'g',
    available: true,
    priceCents: 139,
  })
  return products
}

function basket(store, products) {
  return buildOneStoreBasket({
    store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
}

function syntheticDekaMultipack(priceCents) {
  return {
    supermarket: 'dekamarkt',
    sourceProductId: 'synthetic-rice-6x500g',
    name: 'Basmati rijst',
    currentPriceCents: priceCents,
    currency: 'EUR',
    pack: { rawText: '6 x 500 g', amount: 500, unit: 'g' },
    offer: null,
    availability: 'available',
    provenance: {
      supermarket: 'dekamarkt',
      kind: 'product',
      url: 'https://www.dekamarkt.nl/synthetic-rice',
      capturedAt: '2026-10-10T12:00:00Z',
      sha256: 'b'.repeat(64),
    },
  }
}

test('four-meal eleven-demand controlled comparison keeps 6-pack basket math and worse outcome', () => {
  const baseline = basket(plus, controlledProducts(plus))
  const raw = syntheticDekaMultipack(299)
  const snapshot = structuredClone(raw)
  const rice = projectTrustedObservationForBasket(raw, {
    id: deka.id, supermarket: 'dekamarkt',
  })
  assert.deepEqual(raw, snapshot)
  assert.equal(rice.packCount, 6)

  const candidate = basket(deka, [...controlledProducts(deka, { withRice: false }), rice])
  assert.equal(baseline.selectedMealCount, 4)
  assert.equal(candidate.selectedMealCount, 4)
  assert.equal(baseline.lines.length, 11)
  assert.equal(candidate.lines.length, 11)
  assert.equal(baseline.unresolvedLineCount, 0)
  assert.equal(candidate.unresolvedLineCount, 0)
  const riceLine = candidate.lines.find((line) => line.id === 'basmati-rice')
  assert.equal(riceLine.status, 'matched')
  assert.equal(riceLine.pack.count, 6)
  assert.equal(riceLine.pack.amount, 500)
  assert.equal(riceLine.packs, 1)
  assert.equal(riceLine.lineTotalCents, 299)

  const difference = compareFullBaskets({ baseline, candidate })
  assert.equal(difference.outcome, 'worse')
  assert.equal(difference.claimable, true, 'shape-level synthetic comparator only')
  assert.equal(difference.deltaCents, 50)
  assert.equal(difference.savingsCents, -50)
  assert.equal(difference.lineDeltas.length, 11)
  // Not a real human observation; never pass these fixtures as issue #78 proof.
})

test('four-meal controlled comparison preserves cheaper valid pack instead of forcing positive savings', () => {
  const baseline = basket(plus, controlledProducts(plus))
  const rice = projectTrustedObservationForBasket(syntheticDekaMultipack(199), {
    id: deka.id, supermarket: 'dekamarkt',
  })
  const candidate = basket(deka, [...controlledProducts(deka, { withRice: false }), rice])
  const difference = compareFullBaskets({ baseline, candidate })
  assert.equal(difference.outcome, 'better')
  assert.equal(difference.deltaCents, -50)
  assert.equal(difference.savingsCents, 50)
  assert.equal(difference.lineDeltas.length, 11)
})

test('synthetic store with missing product cannot produce a complete observed comparison', () => {
  const baseline = basket(plus, controlledProducts(plus))
  const candidate = basket(deka, controlledProducts(deka, { withRice: false }))
  assert.equal(candidate.unresolvedLineCount, 1)
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
})
