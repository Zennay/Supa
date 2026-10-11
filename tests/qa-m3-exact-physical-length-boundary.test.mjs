import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// Independent physical-length boundary QA: exactly 10,000 matched rows are
// legitimate synthetic basket facts; 10,001 must abort before inspecting ANY
// indexed descriptor. This is not observed retail evidence (M3 issue #78).
const LIMIT = 10_000

function seedLine() {
  const products = m2Products.map(product => ({
    ...product, storeId: 'seed', id: 'seed-' + product.id,
  }))
  const initial = buildOneStoreBasket({
    store: { id: 'seed', name: 'Voorbeeldwinkel' },
    recipes: m2Recipes, plan: m2InitialPlan,
    activeDays: m2DefaultActiveDays, products,
  })
  const row = initial.lines.find(line => line.status === 'matched')
  assert.ok(row, 'canonical fixture must have a trustworthy physical pack')
  return row
}

function syntheticBasket(id, rowCount, perPackRise = 0) {
  const source = seedLine()
  const pricePerPackCents = source.pricePerPackCents + perPackRise
  const lineTotalCents = source.packs * pricePerPackCents
  assert.ok(Number.isSafeInteger(lineTotalCents))
  const lines = Array.from({ length: rowCount }, (_, index) => ({
    ...source,
    id: 'test-ingredient-' + index,
    ingredientLabel: 'Testingrediënt ' + index,
    productId: id + '-product-' + index,
    productName: 'Testproduct ' + index,
    pricePerPackCents, lineTotalCents,
    requirement: { ...source.requirement },
    pack: { ...source.pack },
    reasons: [],
  }))
  return {
    store: { id, name: 'Fictieve winkel ' + id },
    selectedMealCount: 1,
    lines,
    totalCents: lineTotalCents * rowCount,
    matchedLineCount: rowCount,
    unresolvedLineCount: 0,
  }
}

function guardedIndices(basket) {
  let descriptorVisits = 0
  let indexedGets = 0
  basket.lines = new Proxy(basket.lines, {
    getOwnPropertyDescriptor(target, property) {
      if (/^(0|[1-9]\d*)$/.test(String(property))) descriptorVisits++
      return Reflect.getOwnPropertyDescriptor(target, property)
    },
    get(target, property, receiver) {
      if (/^(0|[1-9]\d*)$/.test(String(property))) {
        indexedGets++
        throw new Error('ordinary indexed GET is untrusted')
      }
      return Reflect.get(target, property, receiver)
    },
  })
  return {
    basket,
    get descriptorVisits() { return descriptorVisits },
    get indexedGets() { return indexedGets },
  }
}

test('exact 10,000 physical rows remain claimable at boundary with precise cents', () => {
  const baseline = guardedIndices(syntheticBasket('fixture-a', LIMIT))
  const candidate = guardedIndices(syntheticBasket('fixture-b', LIMIT, 1))
  const result = compareFullBaskets({ baseline: baseline.basket, candidate: candidate.basket })
  const physicalPacks = seedLine().packs
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, LIMIT * physicalPacks)
  assert.equal(result.savingsCents, -(LIMIT * physicalPacks))
  assert.equal(result.lineDeltas.length, LIMIT)
  assert.equal(result.lineDeltas[0].deltaCents, physicalPacks)
  assert.equal(result.lineDeltas[LIMIT - 1].deltaCents, physicalPacks)
  assert.equal(baseline.descriptorVisits, LIMIT * 2)
  assert.equal(candidate.descriptorVisits, LIMIT * 2)
  assert.equal(baseline.indexedGets, 0)
  assert.equal(candidate.indexedGets, 0)
})

for (const side of ['baseline', 'candidate']) {
  test('10,001 physical rows on ' + side + ' abort before any index inspection', () => {
    const oversized = guardedIndices(syntheticBasket('fixture-large', LIMIT + 1))
    const small = syntheticBasket('fixture-small', 1)
    const result = compareFullBaskets(side === 'baseline'
      ? { baseline: oversized.basket, candidate: small }
      : { baseline: small, candidate: oversized.basket })
    assert.equal(result.claimable, false)
    assert.equal(result.outcome, 'unknown')
    assert.equal(result.deltaCents, null)
    assert.equal(result.savingsCents, null)
    assert.deepEqual(result.lineDeltas, [])
    assert.equal(oversized.descriptorVisits, 0)
    assert.equal(oversized.indexedGets, 0)
  })
}
