import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'

// Product-core acceptance of existing current-main sparse physical-slot guard.
// Completely synthetic: these are not supermarket observations or savings.
const storeA = { id: 'fictional-a', name: 'Voorbeeldwinkel A' }
const storeB = { id: 'fictional-b', name: 'Voorbeeldwinkel B' }
const recipes = [{
  id: 'fictional-rice',
  title: 'Fictief rijstgerecht',
  minutes: 10,
  servings: 1,
  estimatedCost: 0,
  tags: [],
  ingredients: [{
    id: 'rice', label: 'Basmati rijst', query: 'basmati rijst',
    amount: 100, unit: 'g',
  }],
}]
const plan = [{ day: 'Ma', recipeId: 'fictional-rice' }]

function basket(store, priceCents) {
  return buildOneStoreBasket({
    store,
    plan,
    recipes,
    activeDays: ['Ma'],
    products: [{
      id: store.id + '-rice', storeId: store.id,
      name: 'Basmati rijst', available: true,
      packAmount: 100, packUnit: 'g',
      priceCents,
    }],
  })
}
function pair(outcome) {
  const baseline = basket(storeA, 200)
  const candidate = basket(storeB, outcome === 'better' ? 190 : outcome === 'worse' ? 210 : 200)
  for (const b of [baseline, candidate]) {
    assert.equal(b.selectedMealCount, 1)
    assert.equal(b.lines.length, 1)
    assert.equal(b.matchedLineCount, 1)
    assert.equal(b.unresolvedLineCount, 0)
  }
  return { baseline, candidate }
}

for (const expected of ['better', 'same', 'worse']) {
  test(`dense physical rows retain truthful ${expected} money controls`, () => {
    const inputs = pair(expected)
    const result = compareFullBaskets(inputs)
    assert.equal(result.claimable, true)
    assert.equal(result.outcome, expected)
    assert.equal(result.lineDeltas.length, 1)
    assert.equal(result.savingsCents, -result.deltaCents)
    assert.deepEqual(result.reasons, [])
  })
}

function assertUnclaimable({ baseline, candidate }, expectedSide) {
  const result = compareFullBaskets({ baseline, candidate })
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
  assert.match(result.reasons.join(' '),
    new RegExp(expectedSide + ' basket contains an unobserved physical line slot'))
}

for (const side of ['baseline', 'candidate']) {
  for (const expected of ['better', 'same', 'worse']) {
    test(`${side} trailing sparse line prevents synthetic ${expected} claim`, () => {
      const inputs = pair(expected)
      // Keep matched/unresolved counts, total cents and original matched row
      // unchanged. Array.filter/some will silently skip the extra missing slot.
      inputs[side].lines.length += 1
      assert.equal(inputs[side].lines.length, 2)
      assert.equal(Object.hasOwn(inputs[side].lines, 1), false)
      assertUnclaimable(inputs, side)
    })
  }
  test(`${side} leading sparse line cannot be concealed by a later good row`, () => {
    const inputs = pair('better')
    const goodRow = inputs[side].lines[0]
    inputs[side].lines = new Array(2)
    inputs[side].lines[1] = goodRow
    assert.equal(inputs[side].lines[0], undefined)
    assert.equal(Object.hasOwn(inputs[side].lines, 0), false)
    assertUnclaimable(inputs, side)
  })
  test(`${side} entirely sparse physical line never becomes an empty-week financial claim`, () => {
    const inputs = pair('same')
    delete inputs[side].lines[0]
    assert.equal(inputs[side].lines.length, 1)
    assert.equal(Object.hasOwn(inputs[side].lines, 0), false)
    assertUnclaimable(inputs, side)
  })
}

test('a sparse hole in both baskets never manufactures a matched comparison', () => {
  const inputs = pair('better')
  inputs.baseline.lines.length = 2
  inputs.candidate.lines.length = 2
  const result = compareFullBaskets(inputs)
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.deltaCents, null)
  assert.equal(result.savingsCents, null)
  assert.deepEqual(result.lineDeltas, [])
  assert.match(result.reasons.join(' '), /baseline basket contains an unobserved physical line slot/)
  assert.match(result.reasons.join(' '), /candidate basket contains an unobserved physical line slot/)
})
