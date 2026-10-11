import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent adversarial follow-up to #1484: the candidate-first repair can
// still see a BASELINE own-data descriptor hook mutate candidate AFTER the
// candidate snapshot. This is expected RED, not a production incident.
// All prices/stores synthetic; real same-demand PLUS/DekaMarkt #78 is open.
function basket(id) {
  const products = m2Products.map(p => ({ ...p, storeId: id, id: id + '-' + p.id }))
  products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139, available: true,
  })
  const b = buildOneStoreBasket({
    store: { id, name: id }, products, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays,
  })
  assert.equal(b.lines.length, 11)
  assert.equal(b.unresolvedLineCount, 0)
  return b
}
const pair = () => ({ baseline: basket('fixture-a'), candidate: basket('fixture-b') })
function baselineSnapshotHook(data, mutateCandidate) {
  let idDescriptors = 0
  let ordinaryGets = 0
  data.baseline.store = new Proxy(data.baseline.store, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'id' && ++idDescriptors === 2) mutateCandidate(data.candidate)
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
    get(target, key) {
      if (key === 'id') {
        ordinaryGets++
        throw new Error('untrusted baseline store identity ordinary GET')
      }
      return Reflect.get(target, key)
    },
  })
  return {
    get idDescriptors() { return idDescriptors },
    get ordinaryGets() { return ordinaryGets },
  }
}
function unknown(out) {
  assert.equal(out.claimable, false)
  assert.equal(out.outcome, 'unknown')
  assert.equal(out.deltaCents, null)
  assert.equal(out.savingsCents, null)
  assert.deepEqual(out.lineDeltas, [])
}

for (const [name, change] of [
  ['consistent candidate price and root cents', candidate => {
    const line = candidate.lines[0]
    line.pricePerPackCents++
    line.lineTotalCents += line.packs
    candidate.totalCents += line.packs
  }],
  ['candidate product identity only', candidate => {
    candidate.lines[4].productId += '-after-snapshot'
  }],
  ['candidate physical array row order', candidate => {
    const tmp = candidate.lines[0]
    candidate.lines[0] = candidate.lines[10]
    candidate.lines[10] = tmp
  }],
]) {
  test('inverse post-candidate-snapshot mutation must abstain: ' + name, () => {
    const data = pair()
    assert.equal(compareFullBaskets(data).claimable, true)
    const spy = baselineSnapshotHook(data, change)
    const result = compareFullBaskets(data)
    unknown(result)
    assert.equal(spy.idDescriptors, 2)
    assert.equal(spy.ordinaryGets, 0)
  })
}

test('inverse baseline snapshot hook without mutation retains frozen cent equality', () => {
  const data = pair()
  const spy = baselineSnapshotHook(data, () => {})
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.deltaCents, 0)
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
  assert.equal(spy.idDescriptors, 2)
  assert.equal(spy.ordinaryGets, 0)
})
