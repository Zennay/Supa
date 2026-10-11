import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Deliberately synthetic 11-to-12 line M3 Proxy time-of-check drift.
// No real stores, observations or savings proof.
function basket(storeId, increment = 0) {
  const products = m2Products.map(p => ({
    ...p, id: storeId + '-' + p.id, storeId,
    priceCents: p.priceCents + increment,
  }))
  products.push({ id: storeId + '-garam', storeId, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + increment, available: true })
  const b = buildOneStoreBasket({ store: { id: storeId, name: storeId },
    plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products })
  assert.equal(b.lines.length, 11)
  return b
}
const pair = inc => ({ baseline: basket('qa-plus'), candidate: basket('qa-deka', inc ?? 0) })
function driftAfterPreflight(b, extraCents, grow = true) {
  const row = {
    status: 'matched', id: 'qa-synthetic-extra-ingredient',
    ingredientLabel: 'Extra synthetic ingredient',
    requirement: { amount: 1, unit: 'piece' },
    productId: b.store.id + '-extra-product', productName: 'Extra 1 piece',
    packs: 1, pack: { amount: 1, unit: 'piece', count: 1 },
    pricePerPackCents: extraCents, lineTotalCents: extraCents,
    matchScore: 100, reasons: [],
  }
  if (grow) {
    b.matchedLineCount += 1
    b.totalCents += extraCents
  }
  const raw = b.lines
  let reads = 0
  b.lines = new Proxy(raw, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'length') {
        reads += 1
        if (reads === 2 && grow) target.push(row)
      }
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  return { get reads() { return reads }, raw }
}
function unknown(result) {
  assert.equal(result.claimable, false)
  assert.equal(result.outcome, 'unknown')
  assert.equal(result.savingsCents, null)
  assert.equal(result.deltaCents, null)
  assert.deepEqual(result.lineDeltas, [])
}

test('11-to-12 length mutation after preflight cannot turn extra matched demand claimable [RED]', () => {
  const data = pair()
  const a = driftAfterPreflight(data.baseline, 9)
  const b = driftAfterPreflight(data.candidate, 9)
  const comparison = compareFullBaskets(data)
  console.log('QA length drift diagnostic', comparison)
  unknown(comparison)
  assert.equal(a.reads, 2)
  assert.equal(b.reads, 2)
  assert.equal(a.raw.length, 12)
  assert.equal(b.raw.length, 12)
})

test('11-to-12 mutation cannot generate an apparently precise financial worse outcome [RED]', () => {
  const data = pair(1)
  const a = driftAfterPreflight(data.baseline, 9)
  const b = driftAfterPreflight(data.candidate, 10)
  unknown(compareFullBaskets(data))
  assert.equal(a.reads, 2)
  assert.equal(b.reads, 2)
})

test('a second stable length descriptor read still permits canonical 11 matched demands', () => {
  const data = pair()
  const a = driftAfterPreflight(data.baseline, 0, false)
  const b = driftAfterPreflight(data.candidate, 0, false)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.lineDeltas.length, 11)
  assert.equal(a.reads, 2)
  assert.equal(b.reads, 2)
})

test('frozen ordinary full 11-demand baskets remain exactly same', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const outcome = compareFullBaskets(data)
  assert.equal(outcome.claimable, true)
  assert.equal(outcome.outcome, 'same')
  assert.equal(outcome.savingsCents, 0)
  assert.equal(outcome.lineDeltas.length, 11)
})

test('genuine +1-cent per physical pack controlled price delta remains worse', () => {
  const data = pair(1)
  const packs = data.baseline.lines.reduce((sum, row) => sum + row.packs, 0)
  const outcome = compareFullBaskets(data)
  assert.equal(outcome.claimable, true)
  assert.equal(outcome.outcome, 'worse')
  assert.equal(outcome.deltaCents, packs)
})
