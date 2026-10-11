import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// #1453/#1457/#1461/#1474: extend first-row descriptor pin matrix to
// middle and final canonical M2 demands; synthetic, not store observations.
function basket(id, rise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + rise,
  }))
  products.push({ id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + rise, available: true })
  const out = buildOneStoreBasket({
    store: { id, name: id }, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(out.lines.length, 11)
  assert.equal(out.matchedLineCount, 11)
  return out
}
function pair(rise = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', rise) }
}
function trapDescriptor(object, field, drifting) {
  const expected = Reflect.getOwnPropertyDescriptor(object, field)
  assert.ok(expected && Object.hasOwn(expected, 'value'))
  const alternate = typeof expected.value === 'number'
    ? expected.value + 1 : String(expected.value) + '-changed'
  let reads = 0
  let gets = 0
  const wrapped = new Proxy(object, {
    getOwnPropertyDescriptor(target, key) {
      const current = Reflect.getOwnPropertyDescriptor(target, key)
      if (key !== field) return current
      reads++
      if (!drifting) return current
      return { ...current, value: reads === 1 ? alternate : current.value }
    },
    get(target, key, receiver) {
      if (key === field) {
        gets++
        throw new Error('ordinary GET forbidden on tested descriptor')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  return { wrapped, get reads() { return reads }, get gets() { return gets } }
}
function wrap(data, side, index, scope, field, drifting) {
  const row = data[side].lines[index]
  assert.equal(row.status, 'matched')
  let object
  if (scope === 'row') object = row
  else if (scope === 'requirement') object = row.requirement
  else object = row.pack
  const spy = trapDescriptor(object, field, drifting)
  if (scope === 'row') data[side].lines[index] = spy.wrapped
  else row[scope] = spy.wrapped
  return spy
}
function assertUnknown(out) {
  assert.equal(out.outcome, 'unknown')
  assert.equal(out.claimable, false)
  assert.equal(out.deltaCents, null)
  assert.equal(out.savingsCents, null)
  assert.deepEqual(out.lineDeltas, [])
}
const fields = [
  ...['id', 'ingredientLabel', 'productId', 'productName', 'matchScore',
    'packs', 'pricePerPackCents', 'lineTotalCents'].map(f => ['row', f]),
  ...['amount', 'unit'].map(f => ['requirement', f]),
  ...['amount', 'unit', 'count'].map(f => ['pack', f]),
]
for (const side of ['baseline', 'candidate']) {
  for (const index of [5, 10]) {
    for (const [scope, field] of fields) {
      test(side + ' late row[' + index + '] ' + scope + '.' + field +
        ' cannot change between preflight and snapshot', () => {
        const data = pair()
        const spy = wrap(data, side, index, scope, field, true)
        assertUnknown(compareFullBaskets(data))
        assert.equal(spy.reads, 2)
        assert.equal(spy.gets, 0)
      })
    }
    test(side + ' stable late row[' + index + '] nested Proxy remains claimable', () => {
      const data = pair()
      const req = wrap(data, side, index, 'requirement', 'unit', false)
      const pack = wrap(data, side, index, 'pack', 'count', false)
      const price = wrap(data, side, index, 'row', 'lineTotalCents', false)
      const out = compareFullBaskets(data)
      assert.equal(out.claimable, true)
      assert.equal(out.outcome, 'same')
      assert.equal(out.savingsCents, 0)
      assert.equal(out.lineDeltas.length, 11)
      for (const spy of [req, pack, price]) {
        assert.equal(spy.reads, 2)
        assert.equal(spy.gets, 0)
      }
    })
  }
}
test('frozen eleven-demand weighted one-cent worse stays exact', () => {
  const data = pair(1)
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const physicalPacks = data.baseline.lines.reduce((sum, row) => sum + row.packs, 0)
  const out = compareFullBaskets(data)
  assert.equal(out.claimable, true)
  assert.equal(out.outcome, 'worse')
  assert.equal(out.deltaCents, physicalPacks)
  assert.equal(out.savingsCents, -physicalPacks)
  assert.equal(out.lineDeltas.length, 11)
})
