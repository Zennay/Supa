import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// Independent expected-RED M3 #1484 continuation: a descriptor callback on
// candidate SNAPSHOT can change baseline AFTER baseline snapshot materializes.
// The comparator must not quote the now-stale baseline as trustworthy.
// Synthetic retailer identities/prices only; real PLUS/DekaMarkt #78 remains.
function basket(storeId) {
  const products = m2Products.map(p => ({
    ...p, id: storeId + '-' + p.id, storeId,
  }))
  products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139, available: true,
  })
  const result = buildOneStoreBasket({
    store: { id: storeId, name: 'Synthetische winkel ' + storeId },
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

function changeOnCandidateSnapshot(data, mutate) {
  let visits = 0
  let mutations = 0
  let ordinaryGets = 0
  data.candidate.store = new Proxy(data.candidate.store, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'id') {
        visits++
        // First visit: candidate preflight. Second: candidate snapshot,
        // which comes after the baseline's completed snapshot.
        if (visits === 2) {
          mutations++
          mutate(data.baseline)
        }
      }
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
    get(target, key) {
      if (key === 'id') {
        ordinaryGets++
        throw new Error('candidate store ID ordinary GET is forbidden')
      }
      return Reflect.get(target, key)
    },
  })
  return {
    get visits() { return visits },
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
  ['internally consistent cents', baseline => {
    const line = baseline.lines[0]
    assert.equal(line.status, 'matched')
    line.pricePerPackCents += 1
    line.lineTotalCents += line.packs
    baseline.totalCents += line.packs
  }],
  ['matched product identity', baseline => {
    baseline.lines[10].productId += '-changed-after-snapshot'
  }],
  ['physical indexed provenance', baseline => {
    const first = baseline.lines[0]
    baseline.lines[0] = baseline.lines[10]
    baseline.lines[10] = first
  }],
]

for (const [label, mutation] of mutations) {
  test('post-baseline-snapshot candidate intervention must abstain: ' + label, () => {
    const data = pair()
    const before = compareFullBaskets(data)
    assert.equal(before.claimable, true)
    assert.equal(before.outcome, 'same')
    const spy = changeOnCandidateSnapshot(data, mutation)
    const result = compareFullBaskets(data)
    assertUnknown(result)
    assert.equal(spy.mutations, 1)
    assert.ok(spy.visits >= 2)
    assert.equal(spy.ordinaryGets, 0)
    assert.equal(before.outcome, 'same', 'earlier DTO remains independent')
    assert.equal(before.deltaCents, 0)
    assert.equal(before.lineDeltas.length, 11)
  })
}

test('post-baseline-snapshot stable descriptor hook preserves same-price claim', () => {
  const data = pair()
  const spy = changeOnCandidateSnapshot(data, () => {})
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.deltaCents, 0)
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
  assert.equal(spy.mutations, 1)
  assert.ok(spy.visits >= 2)
  assert.equal(spy.ordinaryGets, 0)
})
