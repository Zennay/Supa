import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Independent POSTREPAIR runtime acceptance. All baskets/prices synthetic.
function make(id, rise = 0) {
  const products = m2Products.map(p => ({
    ...p, id: id + '-' + p.id, storeId: id, priceCents: p.priceCents + rise,
  }))
  products.push({ id: id + '-garam', storeId: id, name: 'Garam masala 50 g',
    packAmount: 50, packUnit: 'g', priceCents: 139 + rise, available: true })
  const b = buildOneStoreBasket({ store: { id, name: id },
    plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products })
  assert.equal(b.lines.length, 11)
  return b
}
const pair = rise => ({ baseline: make('qa-plus'), candidate: make('qa-deka', rise ?? 0) })
function mutateAtSecondDescriptor(b, nextLength, money) {
  const original = b.lines
  const extra = {
    status: 'matched', id: 'qa-extra-controlled', ingredientLabel: 'Extra controlled',
    requirement: { amount: 1, unit: 'piece' }, productId: b.store.id + '-extra',
    productName: 'Extra 1 piece', packs: 1,
    pack: { amount: 1, unit: 'piece', count: 1 },
    pricePerPackCents: money, lineTotalCents: money, matchScore: 100, reasons: [],
  }
  if (nextLength === 12) { b.matchedLineCount++; b.totalCents += money }
  let reads = 0
  b.lines = new Proxy(original, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'length' && ++reads === 2) {
        if (nextLength === 12) target.push(extra)
        else target.length = nextLength
      }
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  return { get reads() { return reads } }
}
function failClosed(r) {
  assert.equal(r.claimable, false)
  assert.equal(r.outcome, 'unknown')
  assert.equal(r.deltaCents, null)
  assert.equal(r.savingsCents, null)
  assert.deepEqual(r.lineDeltas, [])
  assert.match(r.reasons.join(' '), /basket runtime snapshot cannot be safely inspected/)
}

test('postrepair a matching 11-to-12 Proxy pair cannot become an accepted same basket', () => {
  const data = pair()
  const a = mutateAtSecondDescriptor(data.baseline, 12, 9)
  const b = mutateAtSecondDescriptor(data.candidate, 12, 9)
  failClosed(compareFullBaskets(data))
  assert.equal(a.reads, 2)
  // A failed baseline snapshot can abort before the candidate's second read.
  assert.ok(b.reads === 1 || b.reads === 2)
})

test('postrepair same physical jump on just one store also fails closed', () => {
  for (const side of ['baseline', 'candidate']) {
    const data = pair()
    const spy = mutateAtSecondDescriptor(data[side], 12, 9)
    failClosed(compareFullBaskets(data))
    assert.equal(spy.reads, 2)
  }
})

test('postrepair in-bound 11-to-10 shrink is also detected, not silently truncated', () => {
  const data = pair()
  const spy = mutateAtSecondDescriptor(data.candidate, 10, 0)
  failClosed(compareFullBaskets(data))
  assert.equal(spy.reads, 2)
})

test('postrepair second-read 10001 jump never triggers physical indexed scan', () => {
  const data = pair()
  const spy = mutateAtSecondDescriptor(data.baseline, 10_001, 0)
  failClosed(compareFullBaskets(data))
  assert.equal(spy.reads, 2)
})

test('postrepair stable 11-slot descriptor Proxy is trusted when all facts agree', () => {
  const data = pair()
  const a = mutateAtSecondDescriptor(data.baseline, 11, 0)
  const b = mutateAtSecondDescriptor(data.candidate, 11, 0)
  const result = compareFullBaskets(data)
  assert.equal(result.claimable, true)
  assert.equal(result.outcome, 'same')
  assert.equal(result.lineDeltas.length, 11)
  assert.equal(a.reads, 2)
  assert.equal(b.reads, 2)
})

test('postrepair ordinary frozen full pair stays exact and one-cent pack rise stays worse', () => {
  const data = pair()
  Object.freeze(data.baseline.lines)
  Object.freeze(data.candidate.lines)
  const same = compareFullBaskets(data)
  assert.equal(same.claimable, true)
  assert.equal(same.outcome, 'same')
  assert.equal(same.savingsCents, 0)

  const expensive = pair(1)
  const packs = expensive.baseline.lines.reduce((sum, line) => sum + line.packs, 0)
  const worse = compareFullBaskets(expensive)
  assert.equal(worse.claimable, true)
  assert.equal(worse.outcome, 'worse')
  assert.equal(worse.deltaCents, packs)
  assert.equal(worse.savingsCents, -packs)
})
