import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Isolated four-meal/11-demand synthetic M3 QA, not real retailer evidence.
function complete(id, addCent = 0, withSpice = true) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + addCent,
  }))
  if (withSpice) products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + addCent,
    available: true,
  })
  const b = buildOneStoreBasket({ store: { id, name: id },
    plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products })
  assert.equal(b.lines.length, 11)
  return b
}
const pair = (rise = 0) => ({
  baseline: complete('qa-plus'),
  candidate: complete('qa-deka', rise),
})
function unclaimable(result, reason) {
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
  assert.match(result.reasons.join(' '), reason)
}

test('matched baseline and candidate object IDs cannot invoke Symbol.toPrimitive in diagnostics [RED]', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    const calls = []
    data[side].lines[2].id = {
      [Symbol.toPrimitive](hint) {
        calls.push(hint)
        return 'spoofed-id'
      },
    }
    const result = compareFullBaskets(data)
    unclaimable(result, /invalid matched-line identity/)
    assert.deepEqual(calls, [], side)
  }
})

test('matched IDs with toString throwers cannot execute while building reason messages [RED]', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    const calls = []
    data[side].lines[3].id = {
      toString() { calls.push('toString'); throw Error('invalid id coerced') },
    }
    const result = compareFullBaskets(data)
    unclaimable(result, /invalid matched-line identity/)
    assert.deepEqual(calls, [], side)
  }
})

test('nonstring Symbol matched IDs keep the invalid-identity reason, not runtime fallback [RED]', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    data[side].lines[4].id = Symbol('m3-invalid-id')
    const result = compareFullBaskets(data)
    unclaimable(result, /invalid matched-line identity/)
    assert.doesNotMatch(result.reasons.join(' '), /runtime snapshot cannot be safely inspected/)
  }
})

test('ordinary valid string ingredient IDs still give explicit coverage diagnostics', () => {
  const data = pair()
  data.candidate.lines[3].id = 'replacement-ingredient'
  const outcome = compareFullBaskets(data)
  unclaimable(outcome, /ingredient/)
  assert.match(outcome.reasons.join(' '), /replacement-ingredient/)
})

test('missing real demand continues to fail closed with a specific unresolved reason', () => {
  const data = pair()
  data.candidate = complete('qa-deka', 0, false)
  unclaimable(compareFullBaskets(data), /unresolved ingredients:/)
})

test('frozen canonical full baskets stay claimable and exact', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const outcome = compareFullBaskets(data)
  assert.equal(outcome.claimable, true)
  assert.equal(outcome.outcome, 'same')
  assert.equal(outcome.savingsCents, 0)
  assert.equal(outcome.lineDeltas.length, 11)
})

test('pack-weighted synthetic +1-cent candidate price remains worse', () => {
  const data = pair(1)
  const packSum = data.baseline.lines.reduce((total, line) => total + line.packs, 0)
  const outcome = compareFullBaskets(data)
  assert.equal(outcome.claimable, true)
  assert.equal(outcome.outcome, 'worse')
  assert.equal(outcome.deltaCents, packSum)
  assert.equal(outcome.savingsCents, -packSum)
})
