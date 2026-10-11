import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Synthetic canonical M2 four-meal/11-demand fixtures. No observed prices.
function basket(storeId, inc = 0) {
  const products = m2Products.map(p => ({
    ...p, id: storeId + '-' + p.id, storeId, priceCents: p.priceCents + inc,
  }))
  products.push({ id: storeId + '-garam', storeId,
    name: 'Garam masala 50 g', packAmount: 50, packUnit: 'g',
    priceCents: 139 + inc, available: true })
  const result = buildOneStoreBasket({
    store: { id: storeId, name: storeId },
    plan: m2InitialPlan, recipes: m2Recipes, activeDays: m2DefaultActiveDays,
    products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  return result
}
const pair = (inc = 0) => ({
  baseline: basket('synthetic-baseline'),
  candidate: basket('synthetic-candidate', inc),
})
function proxyAllGets(target, override = {}) {
  const reads = []
  return {
    proxy: new Proxy(target, {
      get(original, key, receiver) {
        reads.push(String(key))
        if (key in override) return override[key]
        throw Error('caller Proxy GET forbidden: ' + String(key))
      },
    }),
    reads,
  }
}
function same(value) {
  assert.equal(value.claimable, true)
  assert.equal(value.outcome, 'same')
  assert.equal(value.savingsCents, 0)
  assert.equal(value.deltaCents, 0)
  assert.equal(value.lineDeltas.length, 11)
}
function unknown(value) {
  assert.equal(value.claimable, false)
  assert.equal(value.outcome, 'unknown')
  assert.equal(value.savingsCents, null)
  assert.equal(value.deltaCents, null)
  assert.deepEqual(value.lineDeltas, [])
}

test('matched row Proxy GET never executes for either store', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    const p = proxyAllGets(data[side].lines[0])
    data[side].lines[0] = p.proxy
    same(compareFullBaskets(data))
    assert.deepEqual(p.reads, [], side)
  }
})

test('nested requirement and pack Proxy GET must never execute', () => {
  for (const side of ['baseline', 'candidate']) {
    for (const field of ['pack', 'requirement']) {
      const data = pair()
      const p = proxyAllGets(data[side].lines[1][field])
      data[side].lines[1][field] = p.proxy
      same(compareFullBaskets(data))
      assert.deepEqual(p.reads, [], side + ':' + field)
    }
  }
})

test('spoofed matched price GET cannot disguise pack-weighted candidate price rise', () => {
  const data = pair(1)
  const expected = data.baseline.lines.reduce((total, line) => total + line.packs, 0)
  const candidate = data.candidate.lines[3]
  const p = proxyAllGets(candidate, { pricePerPackCents: 0, status: 'matched' })
  data.candidate.lines[3] = p.proxy
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, expected)
  assert.equal(result.savingsCents, -expected)
  assert.deepEqual(p.reads, [])
})

test('ordinary frozen 11-demand data stays claimable while accessor fields abstain', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  same(compareFullBaskets(data))

  const bad = pair()
  let reads = 0
  Object.defineProperty(bad.candidate.lines[1], 'pricePerPackCents', {
    get() { reads++; throw Error('hostile accessor') },
  })
  unknown(compareFullBaskets(bad))
  assert.equal(reads, 0)
})

test('revoked nested pack proxy and physical array holes remain unknown', () => {
  const bad = pair()
  const { proxy, revoke } = Proxy.revocable(bad.baseline.lines[2].pack, {})
  revoke()
  bad.baseline.lines[2].pack = proxy
  unknown(compareFullBaskets(bad))

  const sparse = pair()
  delete sparse.candidate.lines[6]
  unknown(compareFullBaskets(sparse))
})
