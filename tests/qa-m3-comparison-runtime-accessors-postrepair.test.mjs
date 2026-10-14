import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Canonical 11-demand M2 plan; all store identifiers/prices here are synthetic.
function storeBasket(storeId) {
  const products = m2Products.map(product => ({
    ...product, id: storeId + '-' + product.id, storeId,
  }))
  products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139, available: true,
  })
  const result = buildOneStoreBasket({
    store: { id: storeId, name: storeId },
    plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  assert.equal(result.unresolvedLineCount, 0)
  return result
}
function pair() {
  return { baseline: storeBasket('plus-synthetic'), candidate: storeBasket('deka-synthetic') }
}
function abstain(data) {
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
  assert.ok(result.reasons.length > 0)
}
function hostile(record, key, calls) {
  Object.defineProperty(record, key, {
    enumerable: true, configurable: true,
    get() { calls.count++; throw Error('must not read ' + key) },
  })
}

test('postrepair every 11-demand root basket getter abstains without executing it', () => {
  for (const key of ['store', 'lines', 'totalCents', 'matchedLineCount', 'selectedMealCount']) {
    const data = pair()
    const calls = { count: 0 }
    hostile(data.baseline, key, calls)
    abstain(data)
    assert.equal(calls.count, 0, key)
  }
})

test('postrepair either store ID getter is not consulted for a monetary outcome', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    const calls = { count: 0 }
    hostile(data[side].store, 'id', calls)
    abstain(data)
    assert.equal(calls.count, 0, side)
  }
})

test('postrepair matched and nested getter-backed amounts are never executed', () => {
  for (const [path, field] of [
    ['line', 'status'], ['line', 'productName'],
    ['line', 'lineTotalCents'], ['line', 'packs'],
    ['requirement', 'unit'], ['requirement', 'amount'],
    ['pack', 'unit'], ['pack', 'count'], ['pack', 'amount'],
  ]) {
    const data = pair()
    const calls = { count: 0 }
    const line = data.candidate.lines[0]
    hostile(path === 'line' ? line : line[path], field, calls)
    abstain(data)
    assert.equal(calls.count, 0, path + '.' + field)
  }
})

test('postrepair physical slot getter is never accessed', () => {
  const data = pair()
  const calls = { count: 0 }
  hostile(data.candidate.lines, '7', calls)
  abstain(data)
  assert.equal(calls.count, 0)
})

test('postrepair revoked root basket, lines and matched-line Proxy abstain', () => {
  for (const field of ['basket', 'lines', 'line']) {
    const data = pair()
    if (field === 'basket') {
      const r = Proxy.revocable(data.baseline, {})
      r.revoke()
      data.baseline = r.proxy
    } else if (field === 'lines') {
      const r = Proxy.revocable(data.candidate.lines, {})
      r.revoke()
      data.candidate.lines = r.proxy
    } else {
      const r = Proxy.revocable(data.candidate.lines[0], {})
      r.revoke()
      data.candidate.lines[0] = r.proxy
    }
    abstain(data)
  }
})

test('postrepair frozen, null-prototype owned 11-demand baskets remain exactly same', () => {
  const data = pair()
  for (const basket of [data.baseline, data.candidate]) {
    basket.store = Object.freeze(Object.assign(Object.create(null), basket.store))
    for (let index = 0; index < basket.lines.length; index++) {
      const line = basket.lines[index]
      line.pack = Object.freeze(Object.assign(Object.create(null), line.pack))
      line.requirement = Object.freeze(Object.assign(Object.create(null), line.requirement))
      basket.lines[index] = Object.freeze(Object.assign(Object.create(null), line))
    }
    Object.freeze(basket.lines)
    Object.freeze(basket)
  }
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.deltaCents, 0)
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
})

test('postrepair ordinary unsupported statuses keep their specific old diagnostic', () => {
  const data = pair()
  data.baseline.lines[0] = { ...data.baseline.lines[0], status: 'unsupported' }
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, false)
  assert.match(result.reasons.join(' '), /unsupported line shape or status/)
})

test('postrepair non-array lines keep original diagnostic and suppress savings', () => {
  const data = pair()
  data.candidate.lines = { invalid: true }
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, false)
  assert.match(result.reasons.join(' '), /lines are not an array/)
  assert.equal(result.savingsCents, null)
})
