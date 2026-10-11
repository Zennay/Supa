import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Synthetic canonical 11-demand M2. Nominal large arrays model hostile snapshots.
function basket(id, inc = 0) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + inc,
  }))
  products.push({ id: id + '-garam', storeId: id,
    name: 'Garam masala 50 g', packAmount: 50, packUnit: 'g',
    priceCents: 139 + inc, available: true })
  const b = buildOneStoreBasket({ store: { id, name: id },
    plan: m2InitialPlan, recipes: m2Recipes, products,
    activeDays: m2DefaultActiveDays })
  assert.equal(b.lines.length, 11)
  assert.equal(b.matchedLineCount, 11)
  return b
}
function pair(increase = 0) {
  return { baseline: basket('qa-base'), candidate: basket('qa-next', increase) }
}
function oversizedDescriptorProxy(sample) {
  const underlying = new Array(20_000)
  let probes = 0
  const proxy = new Proxy(underlying, {
    getOwnPropertyDescriptor(target, key) {
      if (typeof key === 'string' && /^(?:0|[1-9][0-9]*)$/.test(key)) {
        probes++
        if (probes > 128) throw Error('unbounded physical line scan')
        return {
          configurable: true, enumerable: true, writable: true, value: sample,
        }
      }
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  return { proxy, get probes() { return probes } }
}
function unknown(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

test('over-limit nominal Array Proxy rejects before indexed descriptor reads on baseline', () => {
  const data = pair()
  const probe = oversizedDescriptorProxy(data.baseline.lines[0])
  data.baseline.lines = probe.proxy
  unknown(compareFullBaskets(data))
  assert.equal(probe.probes, 0, 'must guard physical line count before descriptor scans')
})

test('over-limit nominal Array Proxy rejects before indexed descriptor reads on candidate', () => {
  const data = pair()
  const probe = oversizedDescriptorProxy(data.candidate.lines[0])
  data.candidate.lines = probe.proxy
  unknown(compareFullBaskets(data))
  assert.equal(probe.probes, 0)
})

test('over-limit sparse ordinary Array remains promptly unclaimable', () => {
  const data = pair()
  data.baseline.lines = new Array(20_000)
  unknown(compareFullBaskets(data))
})

test('normal canonical eleven-demand basket stays exact same and +1 cent worse', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const same = compareFullBaskets(data)
  assert.equal(same.outcome, 'same')
  assert.equal(same.claimable, true)
  assert.equal(same.lineDeltas.length, 11)
  const more = pair(1)
  const expected = more.baseline.lines.reduce((sum, line) => sum + line.packs, 0)
  const worse = compareFullBaskets(more)
  assert.equal(worse.outcome, 'worse')
  assert.equal(worse.claimable, true)
  assert.equal(worse.deltaCents, expected)
})
