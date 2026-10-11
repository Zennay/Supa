import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Isolated M3 diagnostic-runtime RED; synthetic 11-demand fixture only.
function basket(id, includeGaram = true, extraCent = 0) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id,
    priceCents: p.priceCents + extraCent,
  }))
  if (includeGaram) products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + extraCent, available: true,
  })
  const result = buildOneStoreBasket({
    store: { id, name: id }, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  return result
}
function pair() {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka') }
}
function unknown(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.savingsCents, null)
  assert.equal(result.deltaCents, null)
  assert.deepEqual(result.lineDeltas, [])
}
function unresolvedBasket(id) {
  const b = basket(id, false)
  assert.equal(b.unresolvedLineCount, 1)
  return b
}

test('unresolved numeric-like object id must not invoke Symbol.toPrimitive on either side [RED]', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    data[side] = unresolvedBasket(side + '-unresolved')
    const calls = []
    const line = data[side].lines.find(item => item.status === 'unresolved')
    line.id = {
      [Symbol.toPrimitive](hint) { calls.push(hint); return 'spoofed-ingredient' },
    }
    const outcome = compareFullBaskets(data)
    unknown(outcome)
    assert.deepEqual(calls, [], side + ' must not execute toPrimitive')
    assert.match(outcome.reasons.join(' '), /unresolved|invalid ingredient id/i)
  }
})

test('unresolved toString hook cannot run during diagnostic formatting [RED]', () => {
  const data = pair()
  data.candidate = unresolvedBasket('qa-deka')
  const calls = []
  const line = data.candidate.lines.find(item => item.status === 'unresolved')
  line.id = { toString() { calls.push('toString'); throw Error('unsafe debug formatting') } }
  const result = compareFullBaskets(data)
  unknown(result)
  assert.deepEqual(calls, [])
  assert.match(result.reasons.join(' '), /unresolved|invalid ingredient id/i)
})

test('unresolved Symbol id gives a specific safe diagnostic, not a runtime-crash category [RED]', () => {
  const data = pair()
  data.candidate = unresolvedBasket('qa-deka')
  const line = data.candidate.lines.find(item => item.status === 'unresolved')
  line.id = Symbol('forbidden-id')
  const result = compareFullBaskets(data)
  unknown(result)
  assert.match(result.reasons.join(' '), /unresolved|invalid ingredient id/i)
})

test('legitimate unresolved string id retains informative diagnostics', () => {
  const data = pair()
  data.candidate = unresolvedBasket('qa-deka')
  const result = compareFullBaskets(data)
  unknown(result)
  assert.match(result.reasons.join(' '), /unresolved ingredients:/)
})

test('complete frozen 11-demand basket still reports exact same', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
})

test('complete +1-cent synthetic price rise is pack-weighted worse', () => {
  const data = pair()
  data.candidate = basket('qa-deka', true, 1)
  const packs = data.baseline.lines.reduce((total, line) => total + line.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, packs)
})
