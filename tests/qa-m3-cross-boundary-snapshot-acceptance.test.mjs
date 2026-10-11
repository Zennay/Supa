import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Synthetic M2 cross-boundary acceptance, no real retailer price evidence.
function basket(id, rise = 0) {
  const products = m2Products.map(p => ({ ...p, id: id + '-' + p.id,
    storeId: id, priceCents: p.priceCents + rise }))
  products.push({ id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + rise, available: true })
  const b = buildOneStoreBasket({ store: { id, name: id }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products })
  assert.equal(b.lines.length, 11)
  assert.equal(b.matchedLineCount, 11)
  return b
}
function pair(rise = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', rise) }
}
function shiftingProxy(target, property, firstValue) {
  let reads = 0
  let gets = 0
  const wrapped = new Proxy(target, {
    getOwnPropertyDescriptor(object, key) {
      const d = Reflect.getOwnPropertyDescriptor(object, key)
      if (key !== property) return d
      reads++
      return { ...d, value: reads === 1 ? firstValue : d.value }
    },
    get(object, key, receiver) {
      if (key === property) {
        gets++
        throw new Error('unexpected ordinary GET')
      }
      return Reflect.get(object, key, receiver)
    },
  })
  return { wrapped, get reads() { return reads }, get gets() { return gets } }
}
function mutate(data, side, kind) {
  const b = data[side]
  if (kind === 'root') {
    const spy = shiftingProxy(b, 'totalCents', b.totalCents + 1)
    data[side] = spy.wrapped
    return spy
  }
  if (kind === 'store') {
    const spy = shiftingProxy(b.store, 'id', side === 'baseline' ? 'qa-deka' : 'qa-plus')
    b.store = spy.wrapped
    return spy
  }
  const row = b.lines[0]
  assert.equal(row.status, 'matched')
  if (kind === 'demand') {
    const spy = shiftingProxy(row.requirement, 'amount', row.requirement.amount + 1)
    row.requirement = spy.wrapped
    return spy
  }
  const spy = shiftingProxy(row.pack, 'count', row.pack.count + 1)
  row.pack = spy.wrapped
  return spy
}
function unknown(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.savingsCents, null)
  assert.equal(result.deltaCents, null)
  assert.deepEqual(result.lineDeltas, [])
}
for (const [a, b] of [
  ['root', 'store'], ['demand', 'pack'],
  ['pack', 'root'], ['store', 'demand'],
]) {
  test('combined ' + a + '/' + b + ' TOCTOU must not claim savings', () => {
    const data = pair()
    const baselineSpy = mutate(data, 'baseline', a)
    const candidateSpy = mutate(data, 'candidate', b)
    unknown(compareFullBaskets(data))
    assert.equal(baselineSpy.gets, 0)
    assert.equal(candidateSpy.gets, 0)
    assert.ok(baselineSpy.reads >= 1)
    assert.ok(candidateSpy.reads >= 1)
  })
}
test('stable nested own-data Proxies retain exact 11-demand same result', () => {
  const data = pair()
  for (const side of ['baseline', 'candidate']) {
    const row = data[side].lines[0]
    assert.equal(row.status, 'matched')
    row.requirement = new Proxy(row.requirement, {
      getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
      get(t, k, r) {
        if (k === 'amount') throw new Error('unexpected requirement GET')
        return Reflect.get(t, k, r)
      },
    })
    row.pack = new Proxy(row.pack, {
      getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
      get(t, k, r) {
        if (k === 'count') throw new Error('unexpected pack GET')
        return Reflect.get(t, k, r)
      },
    })
  }
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
})
test('frozen full baskets retain one-cent-per-physical-pack worse result', () => {
  const data = pair(1)
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const packs = data.baseline.lines.reduce((n, line) => n + line.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, packs)
  assert.equal(result.savingsCents, -packs)
})
