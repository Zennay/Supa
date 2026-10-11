import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent postrepair proof with SYNTHETIC M2 11-demand baskets only.
function basket(id, addCent = 0, includeSpice = true) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + addCent,
  }))
  if (includeSpice) products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + addCent, available: true,
  })
  const out = buildOneStoreBasket({ store: { id, name: id },
    plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products })
  assert.equal(out.lines.length, 11)
  return out
}
const pair = (rise = 0) => ({ baseline: basket('qa-plus'), candidate: basket('qa-deka', rise) })
function invalid(outcome) {
  assert.equal(outcome.outcome, 'unknown')
  assert.equal(outcome.claimable, false)
  assert.equal(outcome.deltaCents, null)
  assert.equal(outcome.savingsCents, null)
  assert.deepEqual(outcome.lineDeltas, [])
  assert.ok(outcome.reasons.length > 0)
}

test('postrepair serializing a rejected financial object does not execute its toJSON', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    let calls = 0
    data[side].totalCents = { toJSON() { calls++; throw Error('unsafe JSON callback') } }
    const result = compareFullBaskets(data)
    invalid(result)
    assert.equal(result[side + 'TotalCents'], 0)
    assert.doesNotThrow(() => JSON.stringify(result))
    assert.equal(calls, 0)
    assert.match(result.reasons.join(' '), /invalid monetary value/)
  }
})

test('postrepair rejected Proxy totals never leak getter-capable objects to consumers', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    const gets = []
    data[side].totalCents = new Proxy({}, {
      get(_target, property) { gets.push(String(property)); return 99 },
    })
    const outcome = compareFullBaskets(data)
    invalid(outcome)
    assert.equal(outcome[side + 'TotalCents'], 0)
    JSON.stringify(outcome)
    assert.deepEqual(gets, [])
  }
})

test('postrepair boxed numbers, BigInt, Symbol, arrays, strings and null are never public cents', () => {
  for (const item of [new Number(1999), 1999n, Symbol('price'), ['1999'], '1999', null]) {
    const data = pair()
    data.baseline.totalCents = item
    const outcome = compareFullBaskets(data)
    invalid(outcome)
    assert.equal(outcome.baselineTotalCents, 0)
    assert.equal(typeof outcome.baselineTotalCents, 'number')
    assert.equal(outcome.candidateTotalCents, data.candidate.totalCents)
  }
})

test('postrepair invalid numerical primitives must use a harmless 0 sentinel', () => {
  for (const bad of [NaN, Infinity, -Infinity, -1, 1.2, Number.MAX_SAFE_INTEGER + 2]) {
    const data = pair()
    data.candidate.totalCents = bad
    const result = compareFullBaskets(data)
    invalid(result)
    assert.equal(result.candidateTotalCents, 0)
    assert.equal(result.baselineTotalCents, data.baseline.totalCents)
  }
})

test('postrepair valid zero-cent but mismatched root remains numeric with honest unknown', () => {
  const data = pair()
  data.baseline.totalCents = 0
  const result = compareFullBaskets(data)
  invalid(result)
  assert.equal(result.baselineTotalCents, 0)
  assert.match(result.reasons.join(' '), /total does not match/)
})

test('postrepair known numeric totals persist on unresolved but otherwise safe baskets', () => {
  const data = pair()
  data.candidate = basket('qa-deka', 0, false)
  assert.equal(data.candidate.unresolvedLineCount, 1)
  const result = compareFullBaskets(data)
  invalid(result)
  assert.deepEqual(
    [result.baselineTotalCents, result.candidateTotalCents],
    [data.baseline.totalCents, data.candidate.totalCents],
  )
  assert.match(result.reasons.join(' '), /unresolved ingredients/)
})

test('postrepair full frozen week compares same and +1-cent packs compare worse', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const same = compareFullBaskets(data)
  assert.equal(same.claimable, true)
  assert.equal(same.outcome, 'same')
  assert.equal(same.savingsCents, 0)
  assert.equal(same.lineDeltas.length, 11)

  const expensive = pair(1)
  const packSum = expensive.baseline.lines.reduce((sum, line) => sum + line.packs, 0)
  const worse = compareFullBaskets(expensive)
  assert.equal(worse.claimable, true)
  assert.equal(worse.outcome, 'worse')
  assert.equal(worse.deltaCents, packSum)
  assert.equal(worse.savingsCents, -packSum)
})
