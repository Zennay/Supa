import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { isTrustworthyShoppingBasket } from '../src/features/shopping-list/shoppingListPhysicalValidity.ts'

function canonical() {
  const basket = buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: ['Di'], products: m2Products,
  })
  assert.equal(basket.selectedMealCount, 1)
  assert.equal(basket.unresolvedLineCount, 0)
  assert.equal(basket.matchedLineCount, basket.lines.length)
  return basket
}

function mutateOne(source, change) {
  const copy = structuredClone(source)
  const row = copy.lines.find((line) => line.status === 'matched')
  assert.ok(row)
  change(row)
  return copy
}

test('trusted physical gate accepts only intact canonical one-store baskets', () => {
  const source = canonical()
  const original = structuredClone(source)
  assert.equal(isTrustworthyShoppingBasket(source), true)
  const blank = buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: [], products: m2Products,
  })
  assert.equal(isTrustworthyShoppingBasket(blank), true)
  assert.deepEqual(source, original)
})

test('price-only reprice leaves physical integrity intact while requiring corrected total cents', () => {
  const source = canonical()
  const next = structuredClone(source)
  const row = next.lines.find((line) => line.status === 'matched')
  assert.ok(row)
  row.pricePerPackCents += 1
  row.lineTotalCents += row.packs
  next.totalCents += row.packs
  assert.equal(isTrustworthyShoppingBasket(next), true)
  assert.equal(isTrustworthyShoppingBasket({ ...next, totalCents: source.totalCents }), false)
  assert.equal(isTrustworthyShoppingBasket(source), true)
})

test('unit conversions and legitimate multipacks still cover unchanged physical demand', () => {
  const next = canonical()
  const source = structuredClone(next)
  const rice = next.lines.find((line) => line.id === 'basmati-rice')
  const sauce = next.lines.find((line) => line.id === 'teriyaki-sauce')
  assert.ok(rice?.status === 'matched')
  assert.ok(sauce?.status === 'matched')
  assert.equal(rice.requirement.amount, 150)
  assert.equal(sauce.requirement.amount, 60)
  rice.pack = { ...rice.pack, amount: 0.15, unit: 'kg' }
  sauce.pack = { ...sauce.pack, amount: 0.03, unit: 'l', count: 2 }
  assert.equal(isTrustworthyShoppingBasket(next), true)
  assert.equal(isTrustworthyShoppingBasket(source), true)
})

test('malformed physical coverage and forged packs never authorize a trusted basket', async (t) => {
  const source = canonical()
  const scenarios = [
    ['mass ingredient matched to litres', (line) => { line.pack.unit = 'l' }],
    ['underfilled pack', (line) => { line.pack.amount = 0.00001 }],
    ['subnormal quantity', (line) => { line.pack.amount = Number.MIN_VALUE }],
    ['fake extra whole pack', (line) => { line.packs += 1 }],
    ['overflow of effective package quantity', (line) => {
      line.pack.amount = 1e308
      line.pack.count = Number.MAX_SAFE_INTEGER
    }],
    ['zero package count', (line) => { line.pack.count = 0 }],
    ['negative requirement', (line) => { line.requirement.amount = -1 }],
    ['unknown pack unit', (line) => { line.pack.unit = 'unknown' }],
    ['string-valued package amount', (line) => { line.pack.amount = '1' }],
    ['nonfinite requirement', (line) => { line.requirement.amount = Infinity }],
    ['forged matched cents', (line) => { line.lineTotalCents += 1 }],
    ['untrusted product name', (line) => { line.productName = '' }],
  ]
  for (const [name, mutate] of scenarios) {
    await t.test(name, () => {
      const changed = mutateOne(source, mutate)
      const before = structuredClone(changed)
      assert.equal(isTrustworthyShoppingBasket(changed), false)
      assert.deepEqual(changed, before)
    })
  }
})

test('inconsistent meal, matched, unresolved and total counters fail closed', async (t) => {
  const source = canonical()
  const bad = [
    ['no meals despite nonempty shopping', { ...source, selectedMealCount: 0 }],
    ['counter mismatch', { ...source, matchedLineCount: source.matchedLineCount + 1 }],
    ['negative unresolved', { ...source, unresolvedLineCount: -1 }],
    ['forged zero count', { ...source, selectedMealCount: 0, matchedLineCount: 0 }],
    ['wrong total cents', { ...source, totalCents: source.totalCents + 1 }],
    ['unsafe total', { ...source, totalCents: Number.MAX_SAFE_INTEGER + 1 }],
    ['fractional total', { ...source, totalCents: source.totalCents + 0.1 }],
  ]
  for (const [name, basket] of bad) {
    await t.test(name, () => assert.equal(isTrustworthyShoppingBasket(basket), false))
  }
})

test('unresolved product rows are allowed but malformed identities are not', () => {
  const good = canonical()
  const changed = structuredClone(good)
  const original = changed.lines[0]
  changed.lines[0] = {
    id: original.id, ingredientLabel: original.ingredientLabel,
    requirement: original.requirement, status: 'unresolved',
    reasons: ['synthetic unavailable'], matchScore: null,
  }
  changed.matchedLineCount -= 1
  changed.unresolvedLineCount += 1
  changed.totalCents -= original.lineTotalCents
  assert.equal(isTrustworthyShoppingBasket(changed), true)
  assert.equal(isTrustworthyShoppingBasket({ ...changed, lines: [...changed.lines, changed.lines[0]] }), false)
  changed.lines[0].requirement = { amount: null, unit: 'unknown' }
  assert.equal(isTrustworthyShoppingBasket(changed), true)
  changed.lines[0].requirement = { amount: -1, unit: 'g' }
  assert.equal(isTrustworthyShoppingBasket(changed), false)
})

test('zero-priced but coherent basket is valid; missing cents never become free', () => {
  const source = canonical()
  const zero = structuredClone(source)
  zero.totalCents = 0
  for (const line of zero.lines) if (line.status === 'matched') {
    line.pricePerPackCents = 0
    line.lineTotalCents = 0
  }
  assert.equal(isTrustworthyShoppingBasket(zero), true)
  assert.equal(isTrustworthyShoppingBasket({ ...zero, totalCents: null }), false)
  assert.equal(isTrustworthyShoppingBasket({ ...zero, totalCents: undefined }), false)
})

test('null, primitive or malformed baskets never throw and never authorize progress', () => {
  for (const bad of [null, undefined, 0, '', [], {}, { store: null, lines: [] }]) {
    assert.doesNotThrow(() => isTrustworthyShoppingBasket(bad))
    assert.equal(isTrustworthyShoppingBasket(bad), false)
  }
})
