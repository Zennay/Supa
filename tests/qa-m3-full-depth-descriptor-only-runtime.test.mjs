import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// Full-depth descriptor-only runtime acceptance for M3 #1484.
// No real PLUS/DekaMarkt inputs: all stores and prices are synthetic.
// Earlier #1499 tests protect individual fields; this verifies the entire
// nested root -> store -> array -> rows -> pack/requirement boundary at once.
function basket(storeId, priceRise = 0, includeGaram = true) {
  const products = m2Products.map(p => ({
    ...p, id: storeId + '-' + p.id, storeId,
    priceCents: p.priceCents + priceRise,
  }))
  if (includeGaram) {
    products.push({
      id: storeId + '-garam', storeId,
      name: 'Garam masala 50 g', packAmount: 50, packUnit: 'g',
      priceCents: 139 + priceRise, available: true,
    })
  }
  const result = buildOneStoreBasket({
    store: { id: storeId, name: 'Synthetische winkel ' + storeId },
    recipes: m2Recipes, plan: m2InitialPlan,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  return result
}

// Wrap *all* nested object references, not just known financial fields.
// If the comparator uses even one ordinary property GET on any caller-owned
// input level, it must abstain instead of executing the untrusted trap.
function descriptorOnlyDeepProxy(source) {
  const wrapped = new WeakMap()
  const counts = { ordinaryGets: 0, descriptors: 0 }
  function guard(value) {
    if (value === null || typeof value !== 'object') return value
    if (wrapped.has(value)) return wrapped.get(value)
    const proxy = new Proxy(value, {
      get(target, key) {
        counts.ordinaryGets++
        throw new Error('untrusted ordinary GET on ' + String(key))
      },
      getOwnPropertyDescriptor(target, key) {
        counts.descriptors++
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return descriptor
        // Nonconfigurable, nonwritable properties must expose their exact
        // target values (Array.length is a number and needs no wrapping).
        if (!descriptor.configurable && !descriptor.writable) return descriptor
        return { ...descriptor, value: guard(descriptor.value) }
      },
      getPrototypeOf(target) {
        return Reflect.getPrototypeOf(target)
      },
    })
    wrapped.set(value, proxy)
    return proxy
  }
  return { proxy: guard(source), counts }
}

function snapshot(rise = 0, includeGaram = true) {
  const baseline = basket('fixture-a')
  const candidate = basket('fixture-b', rise, includeGaram)
  const guarded = descriptorOnlyDeepProxy({ baseline, candidate })
  return { baseline, candidate, ...guarded }
}

for (const [label, rise, expected] of [
  ['same', 0, 'same'],
  ['candidate-more-expensive', 1, 'worse'],
  ['candidate-cheaper', -1, 'better'],
]) {
  test('full-depth descriptor-only basket pair stays claimable: ' + label, () => {
    const data = snapshot(rise)
    const totalPacks = data.baseline.lines.reduce((sum, row) => sum + row.packs, 0)
    const result = compareFullBaskets(data.proxy)
    assert.equal(result.claimable, true)
    assert.equal(result.outcome, expected)
    assert.equal(result.deltaCents, totalPacks * rise)
    assert.equal(result.savingsCents, -(totalPacks * rise))
    assert.equal(result.lineDeltas.length, 11)
    assert.ok(result.lineDeltas.every(line => Number.isSafeInteger(line.deltaCents)))
    assert.equal(data.counts.ordinaryGets, 0)
    assert.ok(data.counts.descriptors >= 200,
      'both preflight and snapshot must inspect deeply nested own-data facts')
  })
}

test('full-depth guarded unresolved input abstains without invoking getters', () => {
  const data = snapshot(0, false)
  assert.equal(data.candidate.unresolvedLineCount, 1)
  const result = compareFullBaskets(data.proxy)
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
  assert.ok(result.reasons.some(reason => reason.includes('unresolved ingredients')))
  assert.equal(data.counts.ordinaryGets, 0)
})

test('deeply guarded comparisons have independent DTOs and deterministic replays', () => {
  const data = snapshot(1)
  const first = compareFullBaskets(data.proxy)
  const second = compareFullBaskets(data.proxy)
  assert.equal(first.claimable, true)
  assert.deepEqual(second, first)
  assert.notEqual(second, first)
  assert.notEqual(second.lineDeltas, first.lineDeltas)
  assert.notEqual(second.reasons, first.reasons)
  assert.equal(data.counts.ordinaryGets, 0)
  // Previous DTO stays detached from mutable user-owned arrays and descriptors.
  const before = structuredClone(first)
  data.candidate.lines[0].pricePerPackCents++
  data.candidate.lines[0].lineTotalCents += data.candidate.lines[0].packs
  data.candidate.totalCents += data.candidate.lines[0].packs
  assert.deepEqual(first, before)
  const third = compareFullBaskets(data.proxy)
  assert.equal(third.claimable, true)
  assert.equal(third.outcome, 'worse')
  assert.equal(third.deltaCents, first.deltaCents + data.candidate.lines[0].packs)
  assert.equal(data.counts.ordinaryGets, 0)
})
