import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// #1484 independent TOCTOU QA: a candidate-own-descriptor hook can mutate
// the baseline AFTER baseline preflight but BEFORE the baseline snapshot.
// Cross-basket intervention must never silently promote a changed baseline.
// All inputs are synthetic; M3 genuine retailer #78 is still required.
function basket(storeId) {
  const products = m2Products.map(p => ({
    ...p, id: storeId + '-' + p.id, storeId,
  }))
  products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', available: true, priceCents: 139,
  })
  const result = buildOneStoreBasket({
    store: { id: storeId, name: 'Testwinkel ' + storeId },
    plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
    recipes: m2Recipes, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.unresolvedLineCount, 0)
  return result
}

function pair() {
  return { baseline: basket('fixture-a'), candidate: basket('fixture-b') }
}

function candidateDescriptorIntervention(data, mutateBaseline) {
  let descriptorVisits = 0
  let mutations = 0
  let ordinaryGets = 0
  data.candidate.store = new Proxy(data.candidate.store, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'id') {
        descriptorVisits++
        if (mutations === 0) {
          mutations++
          mutateBaseline(data.baseline)
        }
      }
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
    get(target, key, receiver) {
      if (key === 'id') {
        ordinaryGets++
        throw new Error('untrusted candidate store identity ordinary GET')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return {
    get descriptorVisits() { return descriptorVisits },
    get mutations() { return mutations },
    get ordinaryGets() { return ordinaryGets },
  }
}

function assertUnknown(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

const mutations = [
  ['matched product provenance', baseline => {
    baseline.lines[0].productId += '-changed-after-preflight'
  }],
  ['nested physical pack amount', baseline => {
    baseline.lines[5].pack.amount *= 2
  }],
  ['root financial total', baseline => {
    baseline.totalCents++
  }],
  ['physical row slot swap', baseline => {
    const first = baseline.lines[0]
    baseline.lines[0] = baseline.lines[10]
    baseline.lines[10] = first
  }],
  ['matched ingredient label', baseline => {
    baseline.lines[10].ingredientLabel += ' changed'
  }],
]

for (const [label, mutation] of mutations) {
  test('cross-basket descriptor intervention: ' + label + ' must abstain', () => {
    const data = pair()
    const before = compareFullBaskets(data)
    assert.equal(before.claimable, true)
    assert.equal(before.outcome, 'same')
    const spy = candidateDescriptorIntervention(data, mutation)
    const result = compareFullBaskets(data)
    assertUnknown(result)
    assert.equal(spy.mutations, 1)
    assert.equal(spy.descriptorVisits, 2)
    assert.equal(spy.ordinaryGets, 0)
    assert.equal(before.outcome, 'same')
    assert.equal(before.deltaCents, 0)
    assert.equal(before.lineDeltas.length, 11)
  })
}

test('a read-only candidate descriptor trigger cannot invalidate a stable baseline', () => {
  const data = pair()
  const spy = candidateDescriptorIntervention(data, () => {})
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.deltaCents, 0)
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
  assert.equal(spy.mutations, 1)
  assert.equal(spy.descriptorVisits, 2)
  assert.equal(spy.ordinaryGets, 0)
})
