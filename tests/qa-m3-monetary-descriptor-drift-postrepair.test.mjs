import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent postrepair acceptance on #1455. Controlled prices only.
function basket(id, priceRise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + priceRise,
  }))
  products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + priceRise, available: true,
  })
  const result = buildOneStoreBasket({
    store: { id, name: id },
    plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  return result
}

function pair(priceRise = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', priceRise) }
}

function swappedIndexedRow(basket, change) {
  const originalLines = basket.lines
  const original = originalLines[0]
  assert.equal(original.status, 'matched')
  const replacement = {
    ...original,
    pricePerPackCents: original.pricePerPackCents + change,
    lineTotalCents: original.lineTotalCents + original.packs * change,
  }
  let reads = 0
  let gets = 0
  basket.totalCents += original.packs * change
  basket.lines = new Proxy(originalLines, {
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
      if (property === '0') {
        reads += 1
        if (reads >= 2) return { ...descriptor, value: replacement }
      }
      return descriptor
    },
    get(target, property, receiver) {
      if (property === '0') {
        gets += 1
        throw new Error('unsafe indexed get')
      }
      return Reflect.get(target, property, receiver)
    },
  })
  return { get reads() { return reads }, get gets() { return gets } }
}

function requireUnknown(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

for (const side of ['baseline', 'candidate']) {
  test('postrepair ' + side + ' cannot silently replace a preflighted physical row', () => {
    const data = pair()
    const spy = swappedIndexedRow(data[side], 1)
    requireUnknown(compareFullBaskets(data))
    assert.equal(spy.reads, 2)
    assert.equal(spy.gets, 0)
  })
}

test('postrepair two baskets with stable indexed descriptors retain exact same result', () => {
  const data = pair()
  for (const side of ['baseline', 'candidate']) {
    const original = data[side].lines
    data[side].lines = new Proxy(original, {
      getOwnPropertyDescriptor(target, key) {
        return Reflect.getOwnPropertyDescriptor(target, key)
      },
      get(target, key, receiver) {
        if (key === '0') throw new Error('indexed get must not run')
        return Reflect.get(target, key, receiver)
      },
    })
  }
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
})

test('postrepair frozen canonical 11-demand baskets stay pack-weighted cent exact', () => {
  const normal = pair()
  Object.freeze(normal.baseline.lines)
  Object.freeze(normal.candidate.lines)
  assert.equal(compareFullBaskets(normal).outcome, 'same')
  const more = pair(1)
  const physicalPacks = more.baseline.lines.reduce((sum, line) => sum + line.packs, 0)
  const result = compareFullBaskets(more)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, physicalPacks)
  assert.equal(result.savingsCents, -physicalPacks)
})
