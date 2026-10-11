import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Expected RED for #1457, stacked on immutable postrepair #1456.
// Synthetic M2 four-meal/11-demand prices, never field retailer evidence.
function basket(id, rise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + rise,
  }))
  products.push({
    id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + rise, available: true,
  })
  const result = buildOneStoreBasket({
    store: { id, name: id }, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  return result
}

function pair(rise = 0) {
  return { baseline: basket('qa-plus'), candidate: basket('qa-deka', rise) }
}

function changingRequirement(targetBasket, field) {
  const first = targetBasket.lines[0]
  assert.equal(first.status, 'matched')
  const original = first.requirement
  let descriptorReads = 0
  let unsafeGets = 0
  const descriptorValue = original[field]
  const firstValue = field === 'amount'
    ? descriptorValue + 1
    : (descriptorValue === 'g' ? 'kg' : 'g')
  first.requirement = new Proxy(original, {
    getOwnPropertyDescriptor(target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, property)
      if (property === field) {
        descriptorReads++
        return { ...descriptor, value: descriptorReads === 1 ? firstValue : descriptorValue }
      }
      return descriptor
    },
    get(target, property, receiver) {
      if (property === 'amount' || property === 'unit') {
        unsafeGets++
        throw new Error('ordinary Proxy GET is not safe for observed demand')
      }
      return Reflect.get(target, property, receiver)
    },
  })
  return {
    get descriptorReads() { return descriptorReads },
    get unsafeGets() { return unsafeGets },
  }
}

function assertUnknown(result) {
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.claimable, false)
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

for (const side of ['baseline', 'candidate']) {
  for (const field of ['amount', 'unit']) {
    test('M3 ' + side + ' preflight requirement.' + field + ' drift must abstain', () => {
      const data = pair()
      const observed = changingRequirement(data[side], field)
      assertUnknown(compareFullBaskets(data))
      assert.equal(observed.descriptorReads, 2)
      assert.equal(observed.unsafeGets, 0)
    })
  }
}

test('stable nested requirement descriptors retain exact same outcome', () => {
  const data = pair()
  const first = data.baseline.lines[0]
  assert.equal(first.status, 'matched')
  const original = first.requirement
  first.requirement = new Proxy(original, {
    getOwnPropertyDescriptor: Reflect.getOwnPropertyDescriptor,
    get(target, key, receiver) {
      if (key === 'amount' || key === 'unit') throw new Error('unsafe requirement GET')
      return Reflect.get(target, key, receiver)
    },
  })
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
})

test('frozen canonical same and +1-cent-per-pack outcomes remain exact', () => {
  const same = pair()
  Object.freeze(same.baseline.lines)
  Object.freeze(same.candidate.lines)
  assert.equal(compareFullBaskets(same).outcome, 'same')
  const raised = pair(1)
  const physicalPacks = raised.baseline.lines.reduce((n, line) => n + line.packs, 0)
  const result = compareFullBaskets(raised)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, physicalPacks)
  assert.equal(result.savingsCents, -physicalPacks)
})
