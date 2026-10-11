import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// #1484/#1489: independent physical-position QA. The existing status
// transition acceptance covers slot zero; these cases also exercise every
// middle and last row of the canonical synthetic 11-demand basket.
function basket(storeId, rise = 0) {
  const products = m2Products.map(product => ({
    ...product, id: storeId + '-' + product.id, storeId,
    priceCents: product.priceCents + rise,
  }))
  products.push({
    id: storeId + '-garam', storeId,
    name: 'Garam masala 50 g', packAmount: 50, packUnit: 'g',
    priceCents: 139 + rise, available: true,
  })
  const out = buildOneStoreBasket({
    store: { id: storeId, name: storeId },
    plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(out.lines.length, 11)
  assert.equal(out.matchedLineCount, 11)
  assert.equal(out.unresolvedLineCount, 0)
  assert.ok(out.lines.every(row => row.status === 'matched'))
  return out
}
function pair(rise = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', rise) }
}
function wrapStatus(data, side, index, before, after) {
  const original = data[side].lines[index]
  assert.equal(original.status, 'matched')
  let descriptorReads = 0
  let ordinaryGets = 0
  data[side].lines[index] = new Proxy(original, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (key !== 'status') return descriptor
      descriptorReads++
      return { ...descriptor, value: descriptorReads === 1 ? before : after }
    },
    get(target, key, receiver) {
      if (key === 'status') {
        ordinaryGets++
        throw new Error('unsafe ordinary status GET on caller row')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return {
    get reads() { return descriptorReads },
    get gets() { return ordinaryGets },
  }
}
function assertAbstains(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}
for (const side of ['baseline', 'candidate']) {
  for (let index = 0; index < 11; index++) {
    for (const [before, after] of [
      ['matched', 'unresolved'],
      ['unresolved', 'matched'],
      ['matched', 'unsupported'],
      ['unsupported', 'matched'],
    ]) {
      test(side + ' physical row ' + index + ': ' + before + ' -> ' +
        after + ' cannot claim a financial comparison', () => {
        const data = pair()
        const observed = wrapStatus(data, side, index, before, after)
        assertAbstains(compareFullBaskets(data))
        assert.equal(observed.reads, 2)
        assert.equal(observed.gets, 0)
      })
    }
    test(side + ' physical row ' + index +
      ': unchanged own-data status keeps same 11-demand comparison', () => {
      const data = pair()
      const observed = wrapStatus(data, side, index, 'matched', 'matched')
      const out = compareFullBaskets(data)
      assert.equal(out.outcome, 'same')
      assert.equal(out.claimable, true)
      assert.equal(out.savingsCents, 0)
      assert.equal(out.deltaCents, 0)
      assert.equal(out.lineDeltas.length, 11)
      assert.equal(observed.reads, 2)
      assert.equal(observed.gets, 0)
    })
  }
}
test('both stable row-status proxies retain exact one-cent per physical pack worse', () => {
  const data = pair(1)
  const a = wrapStatus(data, 'baseline', 5, 'matched', 'matched')
  const b = wrapStatus(data, 'candidate', 10, 'matched', 'matched')
  const expectedPacks = basket('qa-plus').lines.reduce((sum, row) => sum + row.packs, 0)
  const out = compareFullBaskets(data)
  assert.equal(out.claimable, true)
  assert.equal(out.outcome, 'worse')
  assert.equal(out.deltaCents, expectedPacks)
  assert.equal(out.savingsCents, -expectedPacks)
  assert.equal(out.lineDeltas.length, 11)
  assert.equal(a.reads, 2)
  assert.equal(b.reads, 2)
  assert.equal(a.gets, 0)
  assert.equal(b.gets, 0)
})
test('frozen 11-demand baskets remain claimable for equal observed fixture prices', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const out = compareFullBaskets(data)
  assert.equal(out.outcome, 'same')
  assert.equal(out.claimable, true)
  assert.equal(out.savingsCents, 0)
  assert.equal(out.lineDeltas.length, 11)
})
