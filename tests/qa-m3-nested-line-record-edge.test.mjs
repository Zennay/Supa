import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { assessWeeklyBasketStudy } from '../src/domain/observedBasketStudy.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

// Isolated synthetic edge-acceptance for QA #1127, after repair #1210.
// No genuine human/retailer prices, receipts or savings evidence.
function basket(store, delta) {
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: [
      ...m2Products.map((p) => ({
        ...p, id: `${store.id}-${p.id}`, storeId: store.id,
        priceCents: p.priceCents + delta,
      })),
      {
        id: `${store.id}-garam-50`, storeId: store.id, name: 'Garam masala 50 g',
        packAmount: 50, packUnit: 'g', available: true, priceCents: 139 + delta,
      },
    ],
  })
}

function study() {
  return {
    schemaVersion: 1,
    studyId: 'qa-edge-2026-40',
    participantKey: 'qa-edge-participant',
    population: 'synthetic',
    region: 'test-only',
    weekStart: '2026-09-28',
    priceContext: 'in-store',
    baseline: {
      evidenceId: 'qa-edge-plus',
      observedAt: '2026-10-02T17:00:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic and not real',
      basket: basket({ id: 'qa-plus', name: 'QA PLUS' }, 0),
    },
    candidate: {
      evidenceId: 'qa-edge-deka',
      observedAt: '2026-10-02T18:15:00Z',
      source: 'manual-cart',
      provenanceNote: 'Synthetic and not real',
      basket: basket({ id: 'qa-deka', name: 'QA DekaMarkt' }, -10),
    },
  }
}

test('postrepair control preserves comparability of valid nested records', () => {
  const value = study()
  const original = structuredClone(value)
  const result = assessWeeklyBasketStudy(value)
  assert.equal(result.claimable, true)
  assert.equal(result.comparison.outcome, 'better')
  assert.equal(result.observationWindowHours, 1.25)
  assert.deepEqual(value, original)
})

for (const side of ['baseline', 'candidate']) {
  for (const [label, field, corrupted] of [
    ['array pack', 'pack', []],
    ['numeric pack', 'pack', 15],
    ['array requirement', 'requirement', []],
    ['string requirement', 'requirement', 'untrusted-secret-marker'],
  ]) {
    test(`postrepair ${side} ${label} fails closed before financial comparison`, () => {
      const value = study()
      const line = value[side].basket.lines.find((row) => row.status === 'matched')
      assert.ok(line)
      line[field] = corrupted
      const original = structuredClone(value)
      let result
      assert.doesNotThrow(() => { result = assessWeeklyBasketStudy(value) })
      assert.equal(result.claimable, false)
      assert.equal(result.comparison.outcome, 'unknown')
      assert.equal(result.comparison.savingsCents, null)
      assert.equal(result.comparison.deltaCents, null)
      assert.deepEqual(result.comparison.lineDeltas, [])
      assert.equal(result.attribution.fullyAttributed, false)
      assert.equal(result.observationWindowHours, null)
      assert.ok(result.reasons.length >= 1)
      assert.doesNotMatch(result.reasons.join(' '), /untrusted-secret-marker/)
      assert.deepEqual(value, original)
    })
  }
}
