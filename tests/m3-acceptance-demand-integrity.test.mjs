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

function completeBasket(storeId) {
  const store = { ...m2Store, id: storeId }
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${storeId}-${product.id}`,
      storeId,
    })),
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
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
  assert.equal(basket.unresolvedLineCount, 0)
  return basket
}

test('C13: reject apparently equal totals when the requested ingredient demand changes', () => {
  const baseline = completeBasket('demand-baseline')
  const candidate = completeBasket('demand-candidate')
  const index = candidate.lines.findIndex((line) => line.status === 'matched')
  assert.ok(index >= 0)
  const line = candidate.lines[index]
  candidate.lines[index] = {
    ...line,
    requirement: { ...line.requirement, amount: line.requirement.amount * 2 },
  }

  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.savingsCents, null)
  assert.equal(result.deltaCents, null)
  assert.deepEqual(result.lineDeltas, [])
  assert.match(result.reasons.join(' '), /ingredient demand differs/)
})

test('C03: missing candidate coverage is never an equivalent cheaper basket', () => {
  const baseline = completeBasket('coverage-baseline')
  const candidate = completeBasket('coverage-candidate')
  const index = candidate.lines.findIndex((line) => line.status === 'matched')
  assert.ok(index >= 0)
  const [missing] = candidate.lines.splice(index, 1)
  candidate.matchedLineCount -= 1
  candidate.totalCents -= missing.lineTotalCents

  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.savingsCents, null)
  assert.equal(result.deltaCents, null)
  assert.deepEqual(result.lineDeltas, [])
  assert.match(result.reasons.join(' '), /coverage differs|missing ingredient/)
})
