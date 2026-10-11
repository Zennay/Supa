import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Real canonical M2 plan/demands but prices/products are controlled test fixtures.
function basket(storeId) {
  const products = m2Products.map(product => ({
    ...product, id: storeId + '-' + product.id, storeId,
  }))
  products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', available: true, priceCents: 139,
  })
  const value = buildOneStoreBasket({
    store: { id: storeId, name: storeId }, products,
    plan: m2InitialPlan, recipes: m2Recipes, activeDays: m2DefaultActiveDays,
  })
  assert.equal(value.matchedLineCount, 11)
  assert.equal(value.unresolvedLineCount, 0)
  return value
}
function pair() {
  return { baseline: basket('plus-controlled'), candidate: basket('dekamarkt-controlled') }
}
function abstain(baseline, candidate) {
  const before = JSON.stringify({ baseline, candidate })
  const comparison = compareFullBaskets({ baseline, candidate })
  assert.equal(comparison.claimable, false)
  assert.equal(comparison.outcome, 'unknown')
  assert.equal(comparison.deltaCents, null)
  assert.equal(comparison.savingsCents, null)
  assert.deepEqual(comparison.lineDeltas, [])
  assert.equal(JSON.stringify({ baseline, candidate }), before)
}

test('postrepair M3 11-demand comparison never trusts prototype-derived status/price/ID', () => {
  for (const side of ['baseline', 'candidate']) {
    const { baseline, candidate } = pair()
    const target = side === 'baseline' ? baseline : candidate
    const inherited = Object.create(target.lines[0])
    assert.equal(Object.hasOwn(inherited, 'lineTotalCents'), false)
    target.lines[0] = inherited
    abstain(baseline, candidate)
  }
})

test('postrepair an own status cannot make inherited matched values financially complete', () => {
  for (const property of ['pricePerPackCents', 'packs', 'productName', 'matchScore']) {
    const { baseline, candidate } = pair()
    const record = Object.create(baseline.lines[0])
    record.status = 'matched'
    record[property] = baseline.lines[0][property]
    assert.equal(Object.hasOwn(record, 'status'), true)
    assert.equal(Object.hasOwn(record, 'id'), false)
    baseline.lines[0] = record
    abstain(baseline, candidate)
  }
})

test('postrepair the nested amount/unit/count must be directly owned', () => {
  for (const key of ['requirement', 'pack']) {
    const { baseline, candidate } = pair()
    const copy = { ...candidate.lines[0] }
    copy[key] = Object.create(copy[key])
    assert.equal(Object.hasOwn(copy[key], key === 'pack' ? 'count' : 'amount'), false)
    candidate.lines[0] = copy
    abstain(baseline, candidate)
  }
})

test('postrepair missing single financial scalar abstains without changing good cents', () => {
  for (const key of ['lineTotalCents', 'pricePerPackCents', 'packs', 'matchScore']) {
    const { baseline, candidate } = pair()
    const line = { ...baseline.lines[0] }
    delete line[key]
    Object.setPrototypeOf(line, baseline.lines[0])
    baseline.lines[0] = line
    abstain(baseline, candidate)
  }
})

test('postrepair all real own M2 line facts stay claimable, with unchanged basket inputs', () => {
  const { baseline, candidate } = pair()
  const before = JSON.stringify({ baseline, candidate })
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.deltaCents, 0)
  assert.equal(result.lineDeltas.length, 11)
  assert.equal(JSON.stringify({ baseline, candidate }), before)
})
