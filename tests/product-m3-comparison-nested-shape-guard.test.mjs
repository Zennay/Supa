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

// Synthetic M2-only evidence. This is a consumer regression for #420, not
// an observation of real retailer prices, receipts or M3 savings.
const stores = [
  { ...m2Store, id: 'nested-baseline', name: 'Synthetic baseline' },
  { ...m2Store, id: 'nested-candidate', name: 'Synthetic candidate' },
]

function makeBasket(store, priceDeltaCents = 0) {
  const products = [
    ...m2Products.map((product) => ({
      ...product,
      id: `${store.id}-${product.id}`,
      storeId: store.id,
      priceCents: Math.max(0, product.priceCents + priceDeltaCents),
    })),
    {
      id: `${store.id}-spice`,
      storeId: store.id,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      available: true,
      priceCents: 139 + priceDeltaCents,
    },
  ]

  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
}

function pair() {
  return {
    baseline: makeBasket(stores[0]),
    candidate: makeBasket(stores[1], -10),
  }
}

function mutateMatchedNestedField(basket, field, replacement) {
  const index = basket.lines.findIndex((line) => line.status === 'matched')
  assert.ok(index >= 0, 'fixture must contain at least one matched line')
  basket.lines[index] = { ...basket.lines[index], [field]: replacement }
}

function assertUnknownFinancialOutcome(comparison) {
  assert.equal(comparison.claimable, false)
  assert.equal(comparison.outcome, 'unknown')
  assert.equal(comparison.deltaCents, null)
  assert.equal(comparison.savingsCents, null)
  assert.deepEqual(comparison.lineDeltas, [])
  assert.ok(comparison.reasons.length > 0)
  assert.match(comparison.reasons.join(' '), /unsupported line shape|invalid matched-line/)
}

test('M3 nested-line comparison preserves valid nonempty M2 matching', () => {
  const comparison = compareFullBaskets(pair())
  assert.equal(comparison.claimable, true)
  assert.equal(comparison.outcome, 'better')
  assert.ok(comparison.lineDeltas.length > 0)
  assert.ok(comparison.savingsCents > 0)
})

for (const side of ['baseline', 'candidate']) {
  for (const field of ['pack', 'requirement']) {
    for (const [name, value] of [
      ['null', null],
      ['undefined', undefined],
      ['array', []],
      ['string', 'not-a-pack'],
      ['number', 7],
      ['boolean', false],
    ]) {
      test(`M3 rejects ${side} matched ${field} as ${name} without throwing (#420)`, () => {
        const baskets = pair()
        mutateMatchedNestedField(baskets[side], field, value)
        let comparison
        assert.doesNotThrow(() => {
          comparison = compareFullBaskets(baskets)
        })
        assertUnknownFinancialOutcome(comparison)
      })
    }
  }
}
