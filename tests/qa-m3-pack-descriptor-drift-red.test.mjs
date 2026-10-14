import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Expected RED on immutable #1460, synthetic M2 four-meal/11-demand only.
function basket(id, extra = 0) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + extra,
  }))
  products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + extra, available: true,
  })
  const result = buildOneStoreBasket({
    store: { id, name: id }, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.matchedLineCount, 11)
  assert.equal(result.lines.length, 11)
  return result
}
function pair(extra = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', extra) }
}

function mutateDescriptor(basket, field) {
  const row = basket.lines[0]
  assert.equal(row.status, 'matched')
  let reads = 0
  let gets = 0
  if (field === 'packs') {
    basket.lines[0] = new Proxy(row, {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
        if (key === 'packs') {
          reads++
          return { ...descriptor, value: reads === 1 ? descriptor.value + 1 : descriptor.value }
        }
        return descriptor
      },
      get(target, key, receiver) {
        if (key === 'packs') { gets++; throw new Error('unsafe physical packs GET') }
        return Reflect.get(target, key, receiver)
      },
    })
  } else {
    const pack = row.pack
    row.pack = new Proxy(pack, {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
        if (key === 'count') {
          reads++
          return { ...descriptor, value: reads === 1 ? descriptor.value + 1 : descriptor.value }
        }
        return descriptor
      },
      get(target, key, receiver) {
        if (key === 'count') { gets++; throw new Error('unsafe pack.count GET') }
        return Reflect.get(target, key, receiver)
      },
    })
  }
  return { get reads() { return reads }, get gets() { return gets } }
}

function assertUnknown(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

for (const side of ['baseline', 'candidate']) {
  for (const field of ['packs', 'count']) {
    test('M3 ' + side + ' physical ' + field + ' descriptor drift must abstain', () => {
      const data = pair()
      const spy = mutateDescriptor(data[side], field)
      assertUnknown(compareFullBaskets(data))
      assert.equal(spy.reads, 2)
      assert.equal(spy.gets, 0)
    })
  }
}

test('stable pack descriptor Proxy keeps all 11 demand lines claimably equal', () => {
  const data = pair()
  const first = data.baseline.lines[0]
  assert.equal(first.status, 'matched')
  first.pack = new Proxy(first.pack, {
    getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
    get(target, key, receiver) {
      if (key === 'count') throw new Error('no ordinary pack GET')
      return Reflect.get(target, key, receiver)
    },
  })
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
})

test('frozen baskets retain one-cent-per-physical-pack worse verdict', () => {
  const equal = pair()
  Object.freeze(equal.baseline.lines)
  Object.freeze(equal.candidate.lines)
  assert.equal(compareFullBaskets(equal).outcome, 'same')
  const data = pair(1)
  const packs = data.baseline.lines.reduce((total, line) => total + line.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, packs)
  assert.equal(result.savingsCents, -packs)
})
