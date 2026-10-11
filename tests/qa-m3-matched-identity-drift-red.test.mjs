import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Expected RED on immutable #1473. Controlled M2 4-meal/11-demand only.
function basket(storeId, rise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: storeId + '-' + p.id, storeId, priceCents: p.priceCents + rise,
  }))
  products.push({ id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + rise, available: true })
  const result = buildOneStoreBasket({
    store: { id: storeId, name: storeId }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  return result
}
function pair(rise = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', rise) }
}
function changingIdentity(basket, field) {
  const row = basket.lines[0]
  assert.equal(row.status, 'matched')
  const alternative = field === 'id' ? row.id + '-preflight' : row.ingredientLabel + ' changed'
  let descriptors = 0
  let gets = 0
  basket.lines[0] = new Proxy(row, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (key === field) {
        descriptors++
        return { ...descriptor, value: descriptors === 1 ? alternative : descriptor.value }
      }
      return descriptor
    },
    get(target, key, receiver) {
      if (key === field) {
        gets++
        throw new Error('unsafe matched-row identity GET')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return { get descriptors() { return descriptors }, get gets() { return gets } }
}
function unknown(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.savingsCents, null)
  assert.equal(result.deltaCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

for (const side of ['baseline', 'candidate']) {
  for (const field of ['id', 'ingredientLabel']) {
    test('M3 ' + side + ' matched ' + field + ' descriptor drift must abstain', () => {
      const data = pair()
      const spy = changingIdentity(data[side], field)
      unknown(compareFullBaskets(data))
      assert.equal(spy.descriptors, 2)
      assert.equal(spy.gets, 0)
    })
  }
}
test('stable matched-row descriptor Proxy retains exact 11-line equality', () => {
  const data = pair()
  const row = data.baseline.lines[0]
  data.baseline.lines[0] = new Proxy(row, {
    getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
    get(target, key, receiver) {
      if (key === 'id') throw new Error('no ordinary matched-id GET')
      return Reflect.get(target, key, receiver)
    },
  })
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
})
test('frozen 11-demand baskets retain exact cent-per-pack worsening', () => {
  const equal = pair()
  Object.freeze(equal.baseline.lines)
  Object.freeze(equal.candidate.lines)
  assert.equal(compareFullBaskets(equal).outcome, 'same')
  const data = pair(1)
  const packs = data.baseline.lines.reduce((n, line) => n + line.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, packs)
  assert.equal(result.savingsCents, -packs)
})
