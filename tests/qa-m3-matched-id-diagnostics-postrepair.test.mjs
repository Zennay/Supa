import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Postrepair independent controlled four-meal/11-demand M2->M3 QA.
// All shops/prices are synthetic, not actual PLUS/DekaMarkt evidence.
function make(id, delta = 0, hasSpice = true) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + delta,
  }))
  if (hasSpice) products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', available: true, priceCents: 139 + delta,
  })
  const b = buildOneStoreBasket({
    store: { id, name: id }, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(b.lines.length, 11)
  return b
}
const pair = rise => ({ baseline: make('qa-plus'), candidate: make('qa-deka', rise ?? 0) })
function abstain(outcome, reason) {
  assert.equal(outcome.claimable, false)
  assert.equal(outcome.outcome, 'unknown')
  assert.equal(outcome.savingsCents, null)
  assert.equal(outcome.deltaCents, null)
  assert.deepEqual(outcome.lineDeltas, [])
  assert.match(outcome.reasons.join(' '), reason)
}
function poisonousId(calls) {
  return {
    [Symbol.toPrimitive]() {
      calls.push('primitive')
      throw Error('never stringify an invalid observed ID')
    },
  }
}

test('postrepair unmatched baseline/candidate matched IDs never stringify arbitrary runtime objects', () => {
  for (const side of ['baseline', 'candidate']) {
    const input = pair()
    const calls = []
    input[side].lines[0].id = poisonousId(calls)
    const outcome = compareFullBaskets(input)
    abstain(outcome, /invalid matched-line identity/)
    assert.match(outcome.reasons.join(' '), /invalid ingredient id/)
    assert.deepEqual(calls, [])
  }
})

test('postrepair both baskets sharing a malformed ID do not invoke coercion for label differences', () => {
  const input = pair()
  const calls = []
  const badId = poisonousId(calls)
  input.baseline.lines[3].id = badId
  input.candidate.lines[3].id = badId
  input.candidate.lines[3].ingredientLabel = 'synthetic-label-drift'
  const outcome = compareFullBaskets(input)
  abstain(outcome, /ingredient label differs/)
  assert.match(outcome.reasons.join(' '), /invalid ingredient id/)
  assert.deepEqual(calls, [])
})

test('postrepair both baskets sharing a malformed ID cannot coerce demand-difference diagnostics', () => {
  const input = pair()
  const calls = []
  const badId = poisonousId(calls)
  input.baseline.lines[1].id = badId
  input.candidate.lines[1].id = badId
  input.candidate.lines[1].requirement.amount += 1
  const outcome = compareFullBaskets(input)
  abstain(outcome, /ingredient demand differs/)
  assert.match(outcome.reasons.join(' '), /invalid ingredient id/)
  assert.deepEqual(calls, [])
})

test('postrepair line-total nonnumeric reasons also guard malformed matching ID', () => {
  const input = pair()
  const calls = []
  const badId = poisonousId(calls)
  input.baseline.lines[5].id = badId
  input.candidate.lines[5].id = badId
  input.candidate.lines[5].lineTotalCents = { valueOf() { calls.push('money'); return 0 } }
  const outcome = compareFullBaskets(input)
  abstain(outcome, /ingredient line total is not numeric/)
  assert.match(outcome.reasons.join(' '), /invalid ingredient id/)
  assert.deepEqual(calls, [])
})

test('postrepair Symbol and null matched IDs abstain without generic runtime reason', () => {
  for (const value of [Symbol('bad'), null, ['bad']]) {
    const input = pair()
    input.baseline.lines[7].id = value
    const outcome = compareFullBaskets(input)
    abstain(outcome, /invalid matched-line identity/)
    assert.doesNotMatch(outcome.reasons.join(' '), /runtime snapshot cannot be safely inspected/)
  }
})

test('postrepair valid string IDs still appear in coverage diagnostics', () => {
  const input = pair()
  input.candidate.lines[0].id = 'swapped-ingredient'
  const outcome = compareFullBaskets(input)
  abstain(outcome, /ingredient/)
  assert.match(outcome.reasons.join(' '), /swapped-ingredient/)
})

test('postrepair legitimate unresolved ingredient remains specifically unknown', () => {
  const input = pair()
  input.candidate = make('qa-deka', 0, false)
  abstain(compareFullBaskets(input), /unresolved ingredients/)
})

test('postrepair frozen full 11-demand same and exact +1-cent weighted worse', () => {
  const input = pair()
  Object.freeze(input.baseline.lines)
  Object.freeze(input.candidate.lines)
  const same = compareFullBaskets(input)
  assert.equal(same.claimable, true)
  assert.equal(same.outcome, 'same')
  assert.equal(same.lineDeltas.length, 11)
  assert.equal(same.savingsCents, 0)

  const dearer = pair(1)
  const packs = dearer.baseline.lines.reduce((sum, line) => sum + line.packs, 0)
  const worse = compareFullBaskets(dearer)
  assert.equal(worse.claimable, true)
  assert.equal(worse.outcome, 'worse')
  assert.equal(worse.deltaCents, packs)
  assert.equal(worse.savingsCents, -packs)
})
