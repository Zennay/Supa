import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'

// C11: malformed cent arithmetic must never produce a savings claim.
// Operates on a generated, complete fixture basket; no real retailer observations.
function complete(storeId) {
  const store = { ...m2Store, id: storeId }
  const products = [
    ...m2Products.map((p) => ({ ...p, id: `${storeId}-${p.id}`, storeId })),
    {
      id: `${storeId}-garam-50`,
      storeId,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139,
    },
  ]
  const basket = buildOneStoreBasket({
    store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(basket.unresolvedLineCount, 0)
  return basket
}

for (const amount of [-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
  test(`C11: reject unsafe basket total ${String(amount)} without savings claim`, () => {
    const baseline = complete('acceptance-baseline')
    const candidate = complete('acceptance-candidate')
    candidate.totalCents = amount
    const result = compareFullBaskets({ baseline, candidate })
    assert.equal(result.claimable, false)
    assert.equal(result.outcome, 'unknown')
    assert.equal(result.deltaCents, null)
    assert.equal(result.savingsCents, null)
    assert.deepEqual(result.lineDeltas, [])
  })
}

test('C11: reject untrustworthy matched line amount even if displayed basket total is unchanged', () => {
  const baseline = complete('acceptance-baseline')
  const candidate = complete('acceptance-candidate')
  const index = candidate.lines.findIndex((line) => line.status === 'matched')
  assert.ok(index >= 0)
  candidate.lines[index] = { ...candidate.lines[index], pricePerPackCents: Number.NaN }
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.savingsCents, null)
  assert.match(result.reasons.join(' '), /invalid matched-line economics/)
})
