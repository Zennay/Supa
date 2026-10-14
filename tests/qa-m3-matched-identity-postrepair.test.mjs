import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent source-fix #1476 acceptance, controlled M2 11-demand only.
function basket(storeId, priceRise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: storeId + '-' + p.id, storeId, priceCents: p.priceCents + priceRise,
  }))
  products.push({ id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + priceRise, available: true })
  const result = buildOneStoreBasket({
    store: { id: storeId, name: storeId }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  return result
}
function pair(priceRise = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', priceRise) }
}
function swappedDescriptor(basket, field) {
  const row = basket.lines[0]
  assert.equal(row.status, 'matched')
  const initial = field === 'matchScore' ? row[field] + 1 : row[field] + '-preflight'
  let reads = 0
  let gets = 0
  basket.lines[0] = new Proxy(row, {
    getOwnPropertyDescriptor(target, key) {
      const d = Reflect.getOwnPropertyDescriptor(target, key)
      if (key !== field) return d
      reads++
      return { ...d, value: reads === 1 ? initial : d.value }
    },
    get(target, key, receiver) {
      if (key === field) {
        gets++
        throw new Error('unsafe matched attribution GET')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return { get reads() { return reads }, get gets() { return gets } }
}
function unknown(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

for (const side of ['baseline', 'candidate']) {
  for (const field of ['productId', 'productName', 'matchScore']) {
    test('postrepair ' + side + ' rejects changed matched ' + field, () => {
      const data = pair()
      const spy = swappedDescriptor(data[side], field)
      unknown(compareFullBaskets(data))
      assert.equal(spy.reads, 2)
      assert.equal(spy.gets, 0)
    })
  }
}
test('postrepair stable matched-row descriptor proxy keeps exact same basket', () => {
  const data = pair()
  const row = data.baseline.lines[0]
  data.baseline.lines[0] = new Proxy(row, {
    getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
    get(target, key, receiver) {
      if (key === 'productId') throw new Error('unsafe matched product GET')
      return Reflect.get(target, key, receiver)
    },
  })
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
})
test('postrepair frozen controlled 11-demand basket retains exact price weighting', () => {
  const equal = pair()
  Object.freeze(equal.baseline.lines)
  Object.freeze(equal.candidate.lines)
  assert.equal(compareFullBaskets(equal).outcome, 'same')
  const data = pair(1)
  const physicalPacks = data.baseline.lines.reduce((n, line) => n + line.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, physicalPacks)
  assert.equal(result.savingsCents, -physicalPacks)
})
