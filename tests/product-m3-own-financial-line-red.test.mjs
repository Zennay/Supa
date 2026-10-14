import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'

function makeBasket(storeId) {
  const basket = buildOneStoreBasket({
    store: { id: storeId, name: storeId },
    plan: [{ day: 'Ma', recipeId: 'rijst' }],
    activeDays: ['Ma'],
    recipes: [{
      id: 'rijst', title: 'Rijstmaaltijd', minutes: 10, servings: 1,
      tags: [], estimatedCost: 1.2,
      ingredients: [{ id: 'rijst', label: 'Rijst', query: 'rijst', amount: 200, unit: 'g' }],
    }],
    products: [{
      id: storeId + '-rice', storeId, name: 'Rijst',
      packAmount: 500, packUnit: 'g', priceCents: 129, available: true,
    }],
  })
  assert.equal(basket.matchedLineCount, 1)
  assert.equal(basket.unresolvedLineCount, 0)
  assert.equal(basket.totalCents, 129)
  return basket
}
function pair() {
  return { baseline: makeBasket('store-plus'), candidate: makeBasket('store-dekamarkt') }
}
function assertUnknown(baseline, candidate) {
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

test('a matched physical line inherited entirely from a prototype cannot carry money', () => {
  const { baseline, candidate } = pair()
  const inherited = Object.create(baseline.lines[0])
  assert.equal(Object.hasOwn(inherited, 'status'), false)
  baseline.lines = [inherited]
  assertUnknown(baseline, candidate)
})

test('own status cannot legitimize inherited financial and matched identity fields', () => {
  const { baseline, candidate } = pair()
  const inherited = Object.create(baseline.lines[0])
  inherited.status = 'matched'
  assert.equal(Object.hasOwn(inherited, 'status'), true)
  assert.equal(Object.hasOwn(inherited, 'lineTotalCents'), false)
  baseline.lines = [inherited]
  assertUnknown(baseline, candidate)
})

test('own matched row cannot trust a demand container inherited through its prototype', () => {
  const { baseline, candidate } = pair()
  const line = { ...baseline.lines[0] }
  line.requirement = Object.create(line.requirement)
  assert.equal(Object.hasOwn(line.requirement, 'amount'), false)
  baseline.lines = [line]
  assertUnknown(baseline, candidate)
})

test('own matched row cannot trust pack quantity and unit inherited through prototype', () => {
  const { baseline, candidate } = pair()
  const line = { ...baseline.lines[0] }
  line.pack = Object.create(line.pack)
  assert.equal(Object.hasOwn(line.pack, 'count'), false)
  baseline.lines = [line]
  assertUnknown(baseline, candidate)
})

test('control: legitimate M2 owned dense matched lines remain claimably equal and immutable', () => {
  const { baseline, candidate } = pair()
  const original = JSON.stringify({ baseline, candidate })
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 1)
  assert.equal(JSON.stringify({ baseline, candidate }), original)
})
