import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent synthetic postrepair QA, not real PLUS/DekaMarkt price evidence.
function basket(id, complete = true, centsExtra = 0) {
  const products = m2Products.map(p => ({
    ...p, storeId: id, id: id + '-' + p.id, priceCents: p.priceCents + centsExtra,
  }))
  if (complete) products.push({
    storeId: id, id: id + '-garam', name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + centsExtra, available: true,
  })
  const value = buildOneStoreBasket({
    store: { id, name: id }, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(value.lines.length, 11)
  return value
}
const pair = () => ({ baseline: basket('qa-plus'), candidate: basket('qa-deka') })
function abstain(result, expectedReason) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
  assert.match(result.reasons.join(' '), expectedReason)
}
function unresolved(data, side) {
  data[side] = basket(side + '-incomplete', false)
  assert.equal(data[side].unresolvedLineCount, 1)
  return data[side].lines.find(line => line.status === 'unresolved')
}

test('postrepair Symbol.toPrimitive and toString never invoked for unresolved ids', () => {
  for (const side of ['baseline', 'candidate']) {
    for (const method of ['toPrimitive', 'toString']) {
      const data = pair()
      const line = unresolved(data, side)
      const calls = []
      line.id = method === 'toPrimitive'
        ? { [Symbol.toPrimitive]() { calls.push(method); return 'spoofed' } }
        : { toString() { calls.push(method); return 'spoofed' } }
      abstain(compareFullBaskets(data), /unresolved ingredients with invalid identifiers/)
      assert.deepEqual(calls, [], side + '/' + method)
    }
  }
})

test('postrepair hostile get trap on unresolved ID stays unvisited', () => {
  const data = pair()
  const line = unresolved(data, 'candidate')
  const accesses = []
  line.id = new Proxy({}, { get(_target, property) {
    accesses.push(String(property))
    throw Error('should never stringify untrusted ID')
  } })
  abstain(compareFullBaskets(data), /unresolved ingredients with invalid identifiers/)
  assert.deepEqual(accesses, [])
})

test('postrepair malformed Symbol/null/array and invisible unresolved identifiers fail safely', () => {
  for (const id of [Symbol('hidden'), null, ['some', 'id'], '   ', '\u200b']) {
    const data = pair()
    unresolved(data, 'candidate').id = id
    abstain(compareFullBaskets(data), /unresolved ingredients with invalid identifiers/)
  }
})

test('postrepair legitimate missing ingredient keeps informative unresolved reason', () => {
  const data = pair()
  const row = unresolved(data, 'baseline')
  const result = compareFullBaskets(data)
  abstain(result, /baseline basket has unresolved ingredients:/)
  assert.match(result.reasons.join(' '), new RegExp(row.id))
})

test('postrepair canonical dense frozen 11-demand baskets still compare same', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const result = compareFullBaskets(data)
  assert.equal(result.outcome, 'same')
  assert.equal(result.claimable, true)
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
})

test('postrepair one-cent physical pack rise remains exactly worse', () => {
  const data = pair()
  data.candidate = basket('qa-deka', true, 1)
  const packs = data.baseline.lines.reduce((sum, line) => sum + line.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.claimable, true)
  assert.equal(result.deltaCents, packs)
  assert.equal(result.savingsCents, -packs)
})
