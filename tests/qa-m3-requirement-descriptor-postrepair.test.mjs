import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Separate independent postrepair acceptance on immutable source fix #1459.
// Synthetic prices and M2 fixture only. No retailer observation.
function basket(id, priceRise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + priceRise,
  }))
  products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + priceRise, available: true,
  })
  const result = buildOneStoreBasket({
    store: { id, name: id }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  return result
}

function pair(priceRise = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', priceRise) }
}

function descriptorSwappedRequirement(targetBasket, changeAmount) {
  const lines = targetBasket.lines
  const row = lines[0]
  assert.equal(row.status, 'matched')
  const original = row.requirement
  const alternative = { ...original, amount: original.amount + (changeAmount ? 1 : 0) }
  let descriptorReads = 0
  let getCalls = 0
  lines[0] = new Proxy(row, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (key === 'requirement') {
        descriptorReads++
        return { ...descriptor, value: descriptorReads === 1 ? original : alternative }
      }
      return descriptor
    },
    get(target, key, receiver) {
      if (key === 'requirement') {
        getCalls++
        throw new Error('unsafe requirement property GET')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return {
    get descriptorReads() { return descriptorReads },
    get getCalls() { return getCalls },
  }
}

function expectUnknown(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

for (const side of ['baseline', 'candidate']) {
  for (const amountDrift of [false, true]) {
    test('postrepair ' + side + ' refuses changed requirement reference, amount drift=' + amountDrift, () => {
      const data = pair()
      const observed = descriptorSwappedRequirement(data[side], amountDrift)
      expectUnknown(compareFullBaskets(data))
      assert.equal(observed.descriptorReads, 2)
      assert.equal(observed.getCalls, 0)
    })
  }
}

test('postrepair stable matched-row descriptor proxy keeps an equal full basket claimable', () => {
  const data = pair()
  const first = data.candidate.lines[0]
  data.candidate.lines[0] = new Proxy(first, {
    getOwnPropertyDescriptor(target, key) {
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
    get(target, key, receiver) {
      if (key === 'requirement') throw new Error('ordinary row GET is forbidden')
      return Reflect.get(target, key, receiver)
    },
  })
  const result = compareFullBaskets(data)
  assert.equal(result.outcome, 'same')
  assert.equal(result.claimable, true)
  assert.equal(result.lineDeltas.length, 11)
  assert.equal(result.savingsCents, 0)
})

test('postrepair frozen 11-demand full baskets preserve pack-weighted +1-cent worse', () => {
  const same = pair()
  Object.freeze(same.baseline.lines)
  Object.freeze(same.candidate.lines)
  assert.equal(compareFullBaskets(same).outcome, 'same')
  const data = pair(1)
  const packs = data.baseline.lines.reduce((n, row) => n + row.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, packs)
  assert.equal(result.savingsCents, -packs)
})
