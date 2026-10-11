import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Synthetic four-meal/11-demand financial runtime QA. These are NOT observed
// PLUS/DekaMarkt prices or savings claims.
function basket(storeId, extraCent = 0) {
  const products = m2Products.map(product => ({
    ...product, storeId, id: storeId + '-' + product.id,
    priceCents: product.priceCents + extraCent,
  }))
  products.push({
    storeId, id: storeId + '-garam', name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', available: true,
    priceCents: 139 + extraCent,
  })
  const result = buildOneStoreBasket({
    store: { id: storeId, name: storeId },
    plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
  assert.equal(result.lines.length, 11)
  assert.equal(result.matchedLineCount, 11)
  return result
}
const pair = (rise = 0) => ({
  baseline: basket('synthetic-plus'),
  candidate: basket('synthetic-deka', rise),
})
function injectNumericObject(line, field, replacement) {
  if (field.startsWith('pack.')) {
    line.pack[field.slice('pack.'.length)] = replacement
  } else {
    line[field] = replacement
  }
}
function failClosed(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.savingsCents, null)
  assert.equal(result.deltaCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

for (const field of [
  'pack.amount', 'pack.count', 'packs', 'pricePerPackCents', 'lineTotalCents',
]) {
  test('numeric coercion hooks cannot execute for ' + field + ' on either observed basket', () => {
    for (const side of ['baseline', 'candidate']) {
      for (const hook of ['toPrimitive', 'valueOf']) {
        const data = pair()
        const calls = []
        const poison = hook === 'toPrimitive'
          ? { [Symbol.toPrimitive](hint) { calls.push('toPrimitive:' + hint); return 1 } }
          : { valueOf() { calls.push('valueOf'); return 1 } }
        injectNumericObject(data[side].lines[3], field, poison)
        failClosed(compareFullBaskets(data))
        assert.deepEqual(calls, [], side + ' / ' + field + ' / ' + hook)
      }
    }
  })
}

test('valid frozen physical 11-demand comparison is still same', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.savingsCents, 0)
  assert.equal(result.lineDeltas.length, 11)
})

test('valid cent-exact +1-cent pack-weighted rise is still worse', () => {
  const data = pair(1)
  const packs = data.baseline.lines.reduce((sum, line) => sum + line.packs, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'worse')
  assert.equal(result.deltaCents, packs)
  assert.equal(result.savingsCents, -packs)
})
