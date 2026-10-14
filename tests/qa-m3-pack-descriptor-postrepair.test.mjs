import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent #1461 postrepair QA. Synthetic M2 prices, no real retailer claim.
function basket(storeId, plus = 0) {
  const products = m2Products.map(p => ({
    ...p, id: storeId + '-' + p.id, storeId, priceCents: p.priceCents + plus,
  }))
  products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + plus, available: true,
  })
  const result = buildOneStoreBasket({
    store: { id: storeId, name: storeId }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  return result
}
function pair(plus = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', plus) }
}

function swapPackObject(basket, alteredAmount) {
  const row = basket.lines[0]
  assert.equal(row.status, 'matched')
  const original = row.pack
  const alternative = { ...original, amount: original.amount + (alteredAmount ? 1 : 0) }
  let reads = 0
  let gets = 0
  basket.lines[0] = new Proxy(row, {
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
      if (property === 'pack') {
        reads++
        return { ...descriptor, value: reads === 1 ? original : alternative }
      }
      return descriptor
    },
    get(target, property, receiver) {
      if (property === 'pack') {
        gets++
        throw new Error('unsafe row pack GET')
      }
      return Reflect.get(target, property, receiver)
    },
  })
  return { get reads() { return reads }, get gets() { return gets } }
}

function requireUnknown(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

for (const side of ['baseline', 'candidate']) {
  for (const alteredAmount of [false, true]) {
    test('postrepair ' + side + ' physical pack reference swap, amountDrift=' + alteredAmount, () => {
      const data = pair()
      const spy = swapPackObject(data[side], alteredAmount)
      requireUnknown(compareFullBaskets(data))
      assert.equal(spy.reads, 2)
      assert.equal(spy.gets, 0)
    })
  }
}

test('stable matched row pack Proxy remains a valid full basket comparison', () => {
  const data = pair()
  const row = data.candidate.lines[0]
  data.candidate.lines[0] = new Proxy(row, {
    getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
    get(target, property, receiver) {
      if (property === 'pack') throw new Error('unsafe row pack GET')
      return Reflect.get(target, property, receiver)
    },
  })
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.lineDeltas.length, 11)
  assert.equal(result.savingsCents, 0)
})

test('frozen all-demand baskets retain exact pack-weighted cent delta', () => {
  const normal = pair()
  Object.freeze(normal.baseline.lines)
  Object.freeze(normal.candidate.lines)
  assert.equal(compareFullBaskets(normal).outcome, 'same')
  const raised = pair(1)
  const packs = raised.baseline.lines.reduce((n, line) => n + line.packs, 0)
  const result = compareFullBaskets(raised)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, packs)
  assert.equal(result.savingsCents, -packs)
})
