import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent synthetic M2 four-meal/11-ingredient acceptance; no real retailer proof.
function make(id, increase = 0, includeSpice = true) {
  const products = m2Products.map(product => ({
    ...product, id: id + '-' + product.id, storeId: id,
    priceCents: product.priceCents + increase,
  }))
  if (includeSpice) products.push({ id: id + '-garam', storeId: id,
    name: 'Garam masala 50 g', packAmount: 50, packUnit: 'g', available: true,
    priceCents: 139 + increase })
  const basket = buildOneStoreBasket({ store: { id, name: id },
    plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
    recipes: m2Recipes, products })
  assert.equal(basket.lines.length, 11)
  return basket
}
const pair = inc => ({ baseline: make('qa-controlled-plus'), candidate: make('qa-controlled-deka', inc ?? 0) })
function throwOnEveryGet(object) {
  const reads = []
  return {
    proxy: new Proxy(object, {
      get(_target, property) {
        reads.push(String(property))
        throw Error('should never read matched financial Proxy: ' + String(property))
      },
    }),
    reads,
  }
}
function failClosed(outcome) {
  assert.equal(outcome.claimable, false)
  assert.equal(outcome.outcome, 'unknown')
  assert.equal(outcome.savingsCents, null)
  assert.equal(outcome.deltaCents, null)
  assert.deepEqual(outcome.lineDeltas, [])
}

test('postrepair matched line proxy with hostile all-property GET stays truly same', () => {
  for (const side of ['baseline', 'candidate']) {
    for (const offset of [0, 4, 10]) {
      const data = pair()
      const trap = throwOnEveryGet(data[side].lines[offset])
      data[side].lines[offset] = trap.proxy
      const result = compareFullBaskets(data)
      assert.equal(result.claimable, true)
      assert.equal(result.outcome, 'same')
      assert.equal(result.savingsCents, 0)
      assert.equal(result.lineDeltas.length, 11)
      assert.deepEqual(trap.reads, [])
    }
  }
})

test('postrepair nested pack and requirement proxies never execute getter on both sides', () => {
  for (const field of ['pack', 'requirement']) {
    for (const side of ['baseline', 'candidate']) {
      const data = pair()
      const trap = throwOnEveryGet(data[side].lines[2][field])
      data[side].lines[2][field] = trap.proxy
      const result = compareFullBaskets(data)
      assert.equal(result.outcome, 'same')
      assert.equal(result.claimable, true)
      assert.deepEqual(trap.reads, [], field + ' / ' + side)
    }
  }
})

test('postrepair nested proxy cannot suppress real synthetic +1-cent multipack cost', () => {
  const data = pair(1)
  const expected = data.baseline.lines.reduce((sum, item) => sum + item.packs, 0)
  const lineTrap = throwOnEveryGet(data.baseline.lines[8])
  const packTrap = throwOnEveryGet(data.candidate.lines[5].pack)
  data.baseline.lines[8] = lineTrap.proxy
  data.candidate.lines[5].pack = packTrap.proxy
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, expected)
  assert.equal(result.savingsCents, -expected)
  assert.deepEqual(lineTrap.reads, [])
  assert.deepEqual(packTrap.reads, [])
})

test('postrepair arbitrary getter on nested match facts abstains without running getter', () => {
  for (const key of ['amount', 'count', 'unit']) {
    const data = pair()
    let reads = 0
    Object.defineProperty(data.candidate.lines[0].pack, key, {
      configurable: true,
      get() { reads++; throw Error('must not execute getter') },
    })
    failClosed(compareFullBaskets(data))
    assert.equal(reads, 0)
  }
})

test('postrepair frozen canonical 11 lines and unresolved controls preserve semantics', () => {
  const control = pair()
  Object.freeze(control.baseline.lines)
  Object.freeze(control.candidate.lines)
  const same = compareFullBaskets(control)
  assert.equal(same.claimable, true)
  assert.equal(same.outcome, 'same')
  assert.equal(same.lineDeltas.length, 11)

  const missing = pair()
  missing.candidate = make('qa-controlled-deka', 0, false)
  const result = compareFullBaskets(missing)
  failClosed(result)
  assert.match(result.reasons.join(' '), /unresolved ingredients/)
})

test('postrepair malformed unsupported status remains specifically diagnosed', () => {
  const data = pair()
  data.baseline.lines[0] = { ...data.baseline.lines[0], status: 'bogus' }
  const result = compareFullBaskets(data)
  failClosed(result)
  assert.match(result.reasons.join(' '), /unsupported line shape or status/)
})
