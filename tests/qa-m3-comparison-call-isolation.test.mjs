import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// Independent reentrancy / call-isolation QA. No retailer observations.
function basket(storeId, priceRise = 0) {
  const products = m2Products.map(p => ({
    ...p, storeId, id: storeId + '-' + p.id,
    priceCents: p.priceCents + priceRise,
  }))
  products.push({
    id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', available: true, priceCents: 139 + priceRise,
  })
  const result = buildOneStoreBasket({
    store: { id: storeId, name: storeId },
    plan: m2InitialPlan, activeDays: m2DefaultActiveDays,
    recipes: m2Recipes, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.unresolvedLineCount, 0)
  return result
}
function pair(rise = 0) {
  return { baseline: basket('fixture-a'), candidate: basket('fixture-b', rise) }
}
test('two separate comparison calls revalidate current cents without stale pins', () => {
  const data = pair()
  const initial = compareFullBaskets(data)
  assert.equal(initial.claimable, true)
  assert.equal(initial.outcome, 'same')
  assert.ok(initial.lineDeltas.every(line => line.deltaCents === 0))

  let extraCents = 0
  for (const row of data.candidate.lines) {
    assert.equal(row.status, 'matched')
    row.pricePerPackCents += 1
    row.lineTotalCents = row.packs * row.pricePerPackCents
    extraCents += row.packs
  }
  data.candidate.totalCents += extraCents

  const changed = compareFullBaskets(data)
  assert.equal(changed.claimable, true)
  assert.equal(changed.outcome, 'worse')
  assert.equal(changed.deltaCents, extraCents)
  assert.equal(changed.savingsCents, -extraCents)
  assert.equal(changed.lineDeltas.length, 11)
  assert.equal(initial.outcome, 'same', 'earlier DTO is independent of future caller data')
  assert.equal(initial.deltaCents, 0)
  assert.ok(initial.lineDeltas.every(line => line.deltaCents === 0))
  assert.notEqual(initial.lineDeltas, changed.lineDeltas)
})

test('after a valid update, a stale root total fails closed without leaking deltas', () => {
  const data = pair()
  assert.equal(compareFullBaskets(data).claimable, true)
  data.candidate.lines[0].pricePerPackCents += 1
  data.candidate.lines[0].lineTotalCents += data.candidate.lines[0].packs
  // Deliberately leave the previous root total: no source-owned live update.
  const outcome = compareFullBaskets(data)
  assert.equal(outcome.claimable, false)
  assert.equal(outcome.outcome, 'unknown')
  assert.equal(outcome.deltaCents, null)
  assert.equal(outcome.savingsCents, null)
  assert.deepEqual(outcome.lineDeltas, [])
})

test('reentrant independent comparison during own-data descriptor inspection is isolated', () => {
  const outer = pair(1)
  const inner = pair()
  let nestedResult = null
  let descriptorVisits = 0
  let ordinaryGets = 0
  outer.candidate.store = new Proxy(outer.candidate.store, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'id') {
        descriptorVisits++
        if (descriptorVisits === 1) nestedResult = compareFullBaskets(inner)
      }
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
    get(target, key, receiver) {
      if (key === 'id') {
        ordinaryGets++
        throw new Error('untrusted store identity ordinary GET')
      }
      return Reflect.get(target, key, receiver)
    },
  })
  const result = compareFullBaskets(outer)
  const physicalPacks = basket('fixture-a').lines.reduce((n, line) => n + line.packs, 0)
  assert.equal(nestedResult?.claimable, true)
  assert.equal(nestedResult?.outcome, 'same')
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, physicalPacks)
  assert.equal(result.savingsCents, -physicalPacks)
  assert.equal(descriptorVisits, 2)
  assert.equal(ordinaryGets, 0)
})
