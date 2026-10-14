import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent positive-control matrix for #1478: descriptor-stable Proxies
// must remain financially valid without invoking ordinary property GET.
function basket(storeId, rise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: storeId + '-' + p.id, storeId, priceCents: p.priceCents + rise,
  }))
  products.push({ id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + rise, available: true })
  const result = buildOneStoreBasket({
    store: { id: storeId, name: storeId }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  return result
}
function pair(rise = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', rise) }
}
function stableOwnDescriptorProxy(object, guardedKey) {
  let descriptors = 0
  let gets = 0
  const wrapped = new Proxy(object, {
    getOwnPropertyDescriptor(target, key) {
      if (key === guardedKey) descriptors++
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
    get(target, key, receiver) {
      if (key === guardedKey) {
        gets++
        throw new Error('ordinary runtime getter must not be used')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return { wrapped, get descriptors() { return descriptors }, get gets() { return gets } }
}
function install(data, side, scope, field) {
  const b = data[side]
  if (scope === 'root') {
    const spy = stableOwnDescriptorProxy(b, field)
    data[side] = spy.wrapped
    return spy
  }
  if (scope === 'store') {
    const spy = stableOwnDescriptorProxy(b.store, field)
    b.store = spy.wrapped
    return spy
  }
  const row = b.lines[0]
  assert.equal(row.status, 'matched')
  if (scope === 'row') {
    const spy = stableOwnDescriptorProxy(row, field)
    b.lines[0] = spy.wrapped
    return spy
  }
  if (scope === 'requirement') {
    const spy = stableOwnDescriptorProxy(row.requirement, field)
    row.requirement = spy.wrapped
    return spy
  }
  const spy = stableOwnDescriptorProxy(row.pack, field)
  row.pack = spy.wrapped
  return spy
}
const pinnedFields = [
  ...['selectedMealCount', 'totalCents', 'matchedLineCount', 'unresolvedLineCount']
    .map(key => ['root', key]),
  ['store', 'id'],
  ...['id', 'ingredientLabel', 'productId', 'productName', 'matchScore',
    'packs', 'pricePerPackCents', 'lineTotalCents'].map(key => ['row', key]),
  ...['amount', 'unit'].map(key => ['requirement', key]),
  ...['amount', 'unit', 'count'].map(key => ['pack', key]),
]
for (const side of ['baseline', 'candidate']) {
  for (const [scope, field] of pinnedFields) {
    test('stable ' + side + ' ' + scope + '.' + field + ' remains claimable without GET', () => {
      const data = pair()
      const spy = install(data, side, scope, field)
      const outcome = compareFullBaskets(data)
      assert.equal(outcome.claimable, true)
      assert.equal(outcome.outcome, 'same')
      assert.equal(outcome.savingsCents, 0)
      assert.equal(outcome.lineDeltas.length, 11)
      assert.equal(spy.gets, 0)
      assert.ok(spy.descriptors >= 2)
    })
  }
}
test('two-store stable root+matched Proxies still preserve weighted worse', () => {
  const data = pair(1)
  const baseline = install(data, 'baseline', 'root', 'totalCents')
  const candidate = install(data, 'candidate', 'row', 'pricePerPackCents')
  const physicalPacks = basket('qa-plus').lines.reduce((sum, line) => sum + line.packs, 0)
  const outcome = compareFullBaskets(data)
  assert.equal(outcome.claimable, true)
  assert.equal(outcome.outcome, 'worse')
  assert.equal(outcome.deltaCents, physicalPacks)
  assert.equal(outcome.savingsCents, -physicalPacks)
  assert.equal(baseline.gets, 0)
  assert.equal(candidate.gets, 0)
})
