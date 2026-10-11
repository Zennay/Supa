import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Synthetic canonical M2 11-demand financial-result runtime boundary.
// NOT real retailer pricing or evidence of observed savings.
function basket(id, increment = 0, includeGaram = true) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id,
    priceCents: p.priceCents + increment,
  }))
  if (includeGaram) products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + increment, available: true,
  })
  const b = buildOneStoreBasket({
    store: { id, name: id }, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(b.lines.length, 11)
  return b
}
const pair = (rise = 0) => ({ baseline: basket('qa-plus'), candidate: basket('qa-deka', rise) })
function expectUnknown(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
  assert.match(result.reasons.join(' '), /invalid monetary value/)
}
function safeTotals(result) {
  for (const cents of [result.baselineTotalCents, result.candidateTotalCents]) {
    assert.equal(typeof cents, 'number')
    assert.equal(Number.isSafeInteger(cents), true)
    assert.ok(cents >= 0)
  }
}

test('invalid basket-root totals cannot escape as caller-owned serializable objects [RED]', () => {
  for (const side of ['baseline', 'candidate']) {
    const calls = []
    const values = [
      new Number(100),
      { toJSON() { calls.push('toJSON'); return 0 } },
      { valueOf() { calls.push('valueOf'); return 0 } },
      new Proxy({}, { get(_target, key) { calls.push(String(key)); return undefined } }),
    ]
    for (const value of values) {
      const data = pair()
      data[side].totalCents = value
      const result = compareFullBaskets(data)
      expectUnknown(result)
      safeTotals(result)
      assert.doesNotThrow(() => JSON.stringify(result))
      assert.deepEqual(calls, [], side)
    }
  }
})

test('invalid primitive root totals cannot be returned as apparently usable cents [RED]', () => {
  for (const side of ['baseline', 'candidate']) {
    for (const total of ['123', Symbol('money'), null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const data = pair()
      data[side].totalCents = total
      const outcome = compareFullBaskets(data)
      expectUnknown(outcome)
      safeTotals(outcome)
    }
  }
})

test('unknown but trusted numeric basket totals retain real controlled basket values', () => {
  const data = pair()
  data.candidate = basket('qa-deka', 0, false)
  assert.equal(data.candidate.unresolvedLineCount, 1)
  const expected = [data.baseline.totalCents, data.candidate.totalCents]
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.match(result.reasons.join(' '), /unresolved ingredients/)
  assert.deepEqual([result.baselineTotalCents, result.candidateTotalCents], expected)
  safeTotals(result)
})

test('valid frozen full 11-demand pair still produces exact same', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
  safeTotals(result)
})

test('valid candidate +1-cent per physical pack still produces accurate worse', () => {
  const data = pair(1)
  const packs = data.baseline.lines.reduce((sum, line) => sum + line.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, packs)
  assert.equal(result.savingsCents, -packs)
  safeTotals(result)
})
