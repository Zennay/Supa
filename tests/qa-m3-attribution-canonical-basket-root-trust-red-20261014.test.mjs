import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { attributeSavingsEffects } from '../src/domain/savingsAttribution.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'

// Test-only M2 fixtures, not observed retailer prices, receipts, or source rights.
function complete(storeId, priceOffset) {
  const products = m2Products.map((p) => ({
    ...p, id: `${storeId}-${p.id}`, storeId,
    priceCents: Math.max(0, p.priceCents + priceOffset),
  }))
  products.push({
    id: `${storeId}-garam-50`, storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', available: true,
    priceCents: 139 + priceOffset,
  })
  return buildOneStoreBasket({
    store: { ...m2Store, id: storeId, name: `Fictional ${storeId}` },
    plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
}
const baseline = complete('fixture-baseline', 0)
assert.equal(baseline.unresolvedLineCount, 0)

// The legitimate basket→comparison→attribution chain must stay useful; this
// prevents overbroad "never claimable" fixes to the direct-API trust bug.
for (const [name, change, expectedOutcome] of [
  ['better', -10, 'better'],
  ['same', 0, 'same'],
  ['worse', 25, 'worse'],
]) {
  test(`canonical 11-line M3 ${name} comparison remains correctly attributable`, () => {
    const candidate = complete(`fixture-${name}`, change)
    assert.equal(candidate.unresolvedLineCount, 0)
    const comparison = compareFullBaskets({ baseline, candidate })
    assert.equal(comparison.claimable, true)
    assert.equal(comparison.outcome, expectedOutcome)
    assert.equal(comparison.savingsCents, -comparison.deltaCents)
    assert.equal(comparison.lineDeltas.length, baseline.matchedLineCount)
    const evidence = comparison.lineDeltas.map((line) => ({
      lineId: line.id, effect: 'offer', deltaCents: line.deltaCents,
      evidenceRef: `fictional-${name}-${line.id}`,
    }))
    const result = attributeSavingsEffects({ comparison, evidence })
    assert.equal(result.status, 'complete')
    assert.equal(result.fullyAttributed, true)
    assert.equal(result.comparisonDeltaCents, comparison.deltaCents)
    assert.equal(result.effectTotals.unknownCents, 0)
  })

  test(`M3 expected RED: forged ${name} title on real two-basket calculation never becomes fully attributed`, () => {
    const candidate = complete(`fixture-${name}-forged`, change)
    const comparison = compareFullBaskets({ baseline, candidate })
    assert.equal(comparison.claimable, true)
    const forged = { ...comparison, outcome: expectedOutcome === 'better' ? 'worse' : 'better' }
    const evidence = comparison.lineDeltas.map((line) => ({
      lineId: line.id, effect: 'offer', deltaCents: line.deltaCents,
      evidenceRef: `fictional-${name}-forged-${line.id}`,
    }))
    const result = attributeSavingsEffects({ comparison: forged, evidence })
    assert.equal(result.status, 'unknown')
    assert.equal(result.fullyAttributed, false)
    assert.equal(result.effectTotals.unknownCents, null)
  })
}
