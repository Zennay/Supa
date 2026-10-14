import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Quality-validation matrix: all preflight-pinned money, attribution,
// requirement, physical pack, store and root descriptors, on both stores.
// Synthetic M2 fixtures; this file never asserts a real retailer price.
function basket(storeId, rise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: storeId + '-' + p.id, storeId, priceCents: p.priceCents + rise,
  }))
  products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + rise, available: true,
  })
  const result = buildOneStoreBasket({
    store: { id: storeId, name: storeId }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  assert.equal(result.unresolvedLineCount, 0)
  return result
}

function pair(rise = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', rise) }
}

function shiftedDescriptor(object, field) {
  const original = Reflect.getOwnPropertyDescriptor(object, field)
  assert.ok(original && Object.hasOwn(original, 'value'))
  const alternative = typeof original.value === 'number'
    ? original.value + 1
    : original.value + '-preflight'
  let reads = 0
  let gets = 0
  const wrapped = new Proxy(object, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key)
      if (key !== field) return descriptor
      reads += 1
      return { ...descriptor, value: reads === 1 ? alternative : descriptor.value }
    },
    get(target, key, receiver) {
      if (key === field) {
        gets += 1
        throw new Error('untrusted property GET ' + String(field))
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return { wrapped, get reads() { return reads }, get gets() { return gets } }
}

function changeDescriptor(data, side, scope, field) {
  const b = data[side]
  if (scope === 'root') {
    const spy = shiftedDescriptor(b, field)
    data[side] = spy.wrapped
    return spy
  }
  if (scope === 'store') {
    const spy = shiftedDescriptor(b.store, field)
    b.store = spy.wrapped
    return spy
  }
  const row = b.lines[0]
  assert.equal(row.status, 'matched')
  if (scope === 'row') {
    const spy = shiftedDescriptor(row, field)
    b.lines[0] = spy.wrapped
    return spy
  }
  if (scope === 'requirement') {
    const spy = shiftedDescriptor(row.requirement, field)
    row.requirement = spy.wrapped
    return spy
  }
  const spy = shiftedDescriptor(row.pack, field)
  row.pack = spy.wrapped
  return spy
}

function assertFailClosed(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

// Every pinned primitive/identity is covered symmetrically. Each case reports
// canonical values during snapshot after a different preflight value, so the
// *only* reason to abstain is that the observed facts changed.
const cases = [
  ...['selectedMealCount', 'totalCents', 'matchedLineCount', 'unresolvedLineCount']
    .map(field => ['root', field]),
  ['store', 'id'],
  ...['id', 'ingredientLabel', 'productId', 'productName', 'matchScore',
    'packs', 'pricePerPackCents', 'lineTotalCents']
    .map(field => ['row', field]),
  ...['amount', 'unit'].map(field => ['requirement', field]),
  ...['amount', 'unit', 'count'].map(field => ['pack', field]),
]

for (const side of ['baseline', 'candidate']) {
  for (const [scope, field] of cases) {
    test('M3 snapshot must pin ' + side + ' ' + scope + '.' + field, () => {
      const data = pair()
      const spy = changeDescriptor(data, side, scope, field)
      assertFailClosed(compareFullBaskets(data))
      assert.equal(spy.gets, 0)
      assert.equal(spy.reads, 2)
    })
  }
}

test('unchanged frozen 11-demand and one-cent pack-weighted baskets remain claimable', () => {
  const same = pair()
  Object.freeze(same.baseline.lines)
  Object.freeze(same.candidate.lines)
  const equal = compareFullBaskets(same)
  assert.equal(equal.outcome, 'same')
  assert.equal(equal.claimable, true)
  assert.equal(equal.lineDeltas.length, 11)
  assert.equal(equal.savingsCents, 0)
  const raised = pair(1)
  const packCount = raised.baseline.lines.reduce((n, row) => n + row.packs, 0)
  const worse = compareFullBaskets(raised)
  assert.equal(worse.outcome, 'worse')
  assert.equal(worse.claimable, true)
  assert.equal(worse.lineDeltas.length, 11)
  assert.equal(worse.deltaCents, packCount)
  assert.equal(worse.savingsCents, -packCount)
})
