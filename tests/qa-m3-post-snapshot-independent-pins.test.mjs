import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// Independent POSTREPAIR acceptance for #1484, distinct from expected RED
// #1502. All basket values are synthetic; real 24h PLUS/DekaMarkt #78 open.
function makeBasket(storeId, priceRise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: storeId + '-' + p.id, storeId,
    priceCents: p.priceCents + priceRise,
  }))
  products.push({
    id: storeId + '-garam', storeId,
    name: 'Garam masala 50 g', packAmount: 50, packUnit: 'g',
    priceCents: 139 + priceRise, available: true,
  })
  const basket = buildOneStoreBasket({
    store: { id: storeId, name: 'Fixture ' + storeId },
    plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
    recipes: m2Recipes, products,
  })
  assert.equal(basket.lines.length, 11)
  assert.equal(basket.unresolvedLineCount, 0)
  return basket
}
function makePair(rise = 0) {
  return { baseline: makeBasket('fixture-a'), candidate: makeBasket('fixture-b', rise) }
}
function candidateSnapshotCallback(data, mutateBaseline) {
  let visits = 0
  let ordinaryGets = 0
  data.candidate.store = new Proxy(data.candidate.store, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'id' && ++visits === 2) mutateBaseline(data.baseline)
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
    get(target, key) {
      if (key === 'id') {
        ordinaryGets++
        throw new Error('must not ordinary-get caller-owned store ID')
      }
      return Reflect.get(target, key)
    },
  })
  return {
    get visits() { return visits },
    get ordinaryGets() { return ordinaryGets },
  }
}
function assertAbstains(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

const adversarialMutations = [
  ['store reference', baseline => {
    baseline.store = { ...baseline.store }
  }],
  ['store identity', baseline => {
    baseline.store.id = 'fixture-changed-after-snapshot'
  }],
  ['reused-row array replacement', baseline => {
    baseline.lines = [...baseline.lines]
  }],
  ['matched physical pack count', baseline => {
    baseline.lines[4].pack.count++
  }],
  ['matched ingredient requirement', baseline => {
    baseline.lines[4].requirement.amount += 1
  }],
  ['root line counters', baseline => {
    baseline.matchedLineCount--
    baseline.unresolvedLineCount++
  }],
]
for (const [label, mutate] of adversarialMutations) {
  test('independent final-baseline-pin verification: ' + label, () => {
    const data = makePair()
    const trap = candidateSnapshotCallback(data, mutate)
    const result = compareFullBaskets(data)
    assertAbstains(result)
    assert.equal(trap.visits, 2, 'candidate descriptor consulted only for preflight and snapshot')
    assert.equal(trap.ordinaryGets, 0)
  })
}

for (const rise of [0, 1, -1]) {
  test('stable post-snapshot callback preserves ' + rise + ' cent per pack', () => {
    const data = makePair(rise)
    const packs = data.baseline.lines.reduce((n, line) => n + line.packs, 0)
    const baseline = structuredClone(data.baseline)
    const trap = candidateSnapshotCallback(data, () => {})
    const actual = compareFullBaskets(data)
    assert.equal(actual.claimable, true)
    assert.equal(actual.outcome, rise === 0 ? 'same' : rise > 0 ? 'worse' : 'better')
    assert.equal(actual.deltaCents, packs * rise)
    assert.equal(actual.savingsCents, -(packs * rise))
    assert.equal(actual.lineDeltas.length, 11)
    assert.deepEqual(data.baseline, baseline, 'source must not mutate caller basket')
    assert.equal(trap.visits, 2)
    assert.equal(trap.ordinaryGets, 0)
  })
}
