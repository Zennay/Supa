import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent status-transition contract: no status changes across the two
// own-data descriptor reads may turn a constructed M3 input into savings.
// Controlled four-meal/eleven-demand M2 fixtures; no retailer evidence.
function basket(store, rise = 0) {
  const products = m2Products.map(p => ({ ...p,
    id: store + '-' + p.id, storeId: store, priceCents: p.priceCents + rise,
  }))
  products.push({ id: store + '-garam', storeId: store, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + rise, available: true })
  const b = buildOneStoreBasket({
    store: { id: store, name: store }, plan: m2InitialPlan,
    activeDays: m2DefaultActiveDays, recipes: m2Recipes, products,
  })
  assert.equal(b.lines.length, 11)
  assert.equal(b.matchedLineCount, 11)
  return b
}
function pair(rise = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', rise) }
}
function statusProxy(data, side, preflight, snapshot) {
  const original = data[side].lines[0]
  assert.equal(original.status, 'matched')
  let reads = 0
  let gets = 0
  data[side].lines[0] = new Proxy(original, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (key !== 'status') return descriptor
      reads++
      return { ...descriptor, value: reads === 1 ? preflight : snapshot }
    },
    get(target, key, receiver) {
      if (key === 'status') {
        gets++
        throw new Error('ordinary runtime status GET must not run')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return { get reads() { return reads }, get gets() { return gets } }
}
function assertUnknown(out) {
  assert.equal(out.outcome, 'unknown')
  assert.equal(out.claimable, false)
  assert.equal(out.deltaCents, null)
  assert.equal(out.savingsCents, null)
  assert.deepEqual(out.lineDeltas, [])
}
for (const side of ['baseline', 'candidate']) {
  for (const [preflight, snapshot] of [
    ['matched', 'unresolved'], ['unresolved', 'matched'],
    ['matched', 'invalid'], ['invalid', 'matched'],
  ]) {
    test(side + ' status ' + preflight + ' to ' + snapshot + ' cannot claim money', () => {
      const data = pair()
      const spy = statusProxy(data, side, preflight, snapshot)
      assertUnknown(compareFullBaskets(data))
      assert.ok(spy.reads >= 1)
      assert.equal(spy.gets, 0)
    })
  }
  test(side + ' stable matched descriptor still preserves 11-demand equality', () => {
    const data = pair()
    const spy = statusProxy(data, side, 'matched', 'matched')
    const out = compareFullBaskets(data)
    assert.equal(out.outcome, 'same')
    assert.equal(out.claimable, true)
    assert.equal(out.savingsCents, 0)
    assert.equal(out.lineDeltas.length, 11)
    assert.equal(spy.reads, 2)
    assert.equal(spy.gets, 0)
  })
}
test('frozen physical +1-cent-per-pack worse is still exact', () => {
  const data = pair(1)
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const physicalPacks = data.baseline.lines.reduce((sum, row) => sum + row.packs, 0)
  const out = compareFullBaskets(data)
  assert.equal(out.outcome, 'worse')
  assert.equal(out.claimable, true)
  assert.equal(out.deltaCents, physicalPacks)
  assert.equal(out.savingsCents, -physicalPacks)
})
