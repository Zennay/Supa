import assert from 'node:assert/strict'
import test from 'node:test'

import { projectFreshControlledComparisonCatalogs } from '../src/data/trustedMultipackComparisonCatalog.ts'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

// All prices below are synthetic test fixtures; this is NOT M3 field evidence.
const plus = { id: 'controlled-plus', name: 'Synthetic PLUS' }
const deka = { id: 'controlled-deka', name: 'Synthetic DekaMarkt' }

function riceObservation(supermarket, capturedAt, priceCents) {
  const multipack = supermarket === 'dekamarkt'
  return {
    supermarket,
    sourceProductId: 'rice-pack',
    name: 'Basmati rijst',
    currentPriceCents: priceCents,
    currency: 'EUR',
    pack: multipack
      ? { rawText: '6 x 500 g', amount: 500, unit: 'g' }
      : { rawText: '1 kg', amount: 1, unit: 'kg' },
    offer: null,
    availability: 'available',
    provenance: {
      supermarket, kind: 'product',
      url: multipack
        ? 'https://www.dekamarkt.nl/synthetic-rice'
        : 'https://www.plus.nl/synthetic-rice',
      capturedAt, sha256: 'f'.repeat(64),
    },
  }
}

function compare(plusCapturedAt = '2026-10-10T10:00:00Z', dekaCapturedAt = '2026-10-10T14:00:00+02:00') {
  const controlled = projectFreshControlledComparisonCatalogs({
    baselineStore: { id: plus.id, supermarket: 'plus' },
    candidateStore: { id: deka.id, supermarket: 'dekamarkt' },
    baselineObservations: [riceObservation('plus', plusCapturedAt, 249)],
    candidateObservations: [riceObservation('dekamarkt', dekaCapturedAt, 299)],
    referenceTime: '2026-10-10T12:00:00Z',
  })
  if (controlled === null) return null

  const build = (store, projected) => {
    // Remaining catalog rows are the existing M2 fixture, not real observations.
    const fixtureProducts = m2Products
      .filter(p => p.id !== 'basmati-1kg')
      .map(p => ({ ...p, id: `${store.id}-${p.id}`, storeId: store.id }))
    return buildOneStoreBasket({
      store, plan: m2InitialPlan, recipes: m2Recipes,
      activeDays: m2DefaultActiveDays,
      products: [
        ...fixtureProducts,
        { id: `${store.id}-garam-50`, storeId: store.id,
          name: 'Garam masala 50 g', packAmount: 50, packUnit: 'g',
          available: true, priceCents: 139 },
        ...projected,
      ],
    })
  }
  const baseline = build(plus, controlled.baseline)
  const candidate = build(deka, controlled.candidate)
  return { controlled, baseline, candidate, comparison: compareFullBaskets({ baseline, candidate }) }
}

test('fresh controlled two-store packs integrate into all eleven real M2 demand lines without phantom purchases', () => {
  const result = compare()
  assert.ok(result)
  assert.equal(result.controlled.captureWindowHours, 2)
  assert.equal(result.baseline.selectedMealCount, 4)
  assert.equal(result.baseline.lines.length, 11)
  assert.equal(result.candidate.lines.length, 11)
  assert.equal(result.baseline.unresolvedLineCount, 0)
  assert.equal(result.candidate.unresolvedLineCount, 0)

  const riceLine = result.candidate.lines.find(line => line.id === 'basmati-rice')
  assert.ok(riceLine)
  assert.equal(riceLine.status, 'matched')
  assert.equal(riceLine.pack.count, 6)
  assert.equal(riceLine.packs, 1)
  assert.equal(riceLine.lineTotalCents, 299)
  assert.equal(result.comparison.outcome, 'worse')
  assert.equal(result.comparison.deltaCents, 50)
  assert.equal(result.comparison.savingsCents, -50)
  assert.equal(result.comparison.lineDeltas.length, 11)
  // Structural comparison is synthetic and must NOT become public savings evidence.
})

test('the controlled source freshness gate blocks downstream comparison before any old pack is priced', () => {
  assert.equal(compare('2026-10-09T11:59:59Z'), null)
  assert.equal(compare(undefined, '2026-10-10T12:00:01Z'), null)
})
