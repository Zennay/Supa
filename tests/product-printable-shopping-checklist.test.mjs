import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
  m2Store,
} from '../src/data/m2Fixture.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'

function basket(products = m2Products, activeDays = m2DefaultActiveDays) {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays,
    products,
  })
}

test('printable checklist keeps the real M2 line order and never exports monetary evidence', () => {
  const source = basket()
  const before = structuredClone(source)
  const result = preparePrintableShoppingChecklist(source)

  assert.equal(result.lines.length, source.lines.length)
  assert.deepEqual(result.lines.map((line) => line.id), source.lines.map((line) => line.id))
  assert.equal(result.isDemo, true)
  assert.equal(result.storeLabel, 'Voorbeeldwinkel · demo')
  assert.deepEqual(source, before)
  const serialized = JSON.stringify(result)
  assert.doesNotMatch(serialized, /priceCents|totalCents|savingsCents|publicSavingsClaimEligible|observedAt/)
})

test('printable checklist uses Dutch physical piece labels rather than canonical piece', () => {
  const result = preparePrintableShoppingChecklist(basket())
  const cauliflower = result.lines.find((line) => line.id === 'cauliflower')
  assert.ok(cauliflower)
  assert.match(cauliflower.quantity, /2 × 1 stuk/)
  assert.doesNotMatch(cauliflower.quantity, /piece|unknown/)
})

test('unknown products remain explicit manual choices, never made-up matches', () => {
  const source = basket(m2Products.filter((product) => product.id !== 'chicken-400'))
  const result = preparePrintableShoppingChecklist(source)
  const chicken = result.lines.find((line) => line.id === 'chicken-thigh')
  assert.ok(chicken)
  assert.equal(chicken.needsReview, true)
  assert.equal(chicken.label, 'Kippendij')
  assert.match(chicken.quantity, /600 g · handmatig kiezen/)
  assert.equal(result.reviewCount, result.lines.filter((line) => line.needsReview).length)
})

test('unknown quantity never turns into a bogus purchase count', () => {
  const source = structuredClone(basket())
  source.lines[0] = {
    id: 'basmati-rice',
    ingredientLabel: 'Basmati rijst',
    requirement: { amount: null, unit: 'unknown' },
    status: 'unresolved',
    reasons: ['unknown amount'],
    matchScore: null,
  }
  const result = preparePrintableShoppingChecklist(source)
  assert.equal(result.lines[0].needsReview, true)
  assert.equal(result.lines[0].quantity, 'hoeveelheid onbekend · handmatig kiezen')
})

test('one outer multipack says verpakking, never 1 verpakkingen (independent QA #2071)', () => {
  const source = structuredClone(basket())
  const line = source.lines.find((item) => item.status === 'matched')
  assert.ok(line)
  line.requirement = { amount: 600, unit: 'g' }
  line.pack = { amount: 300, unit: 'g', count: 2 }
  line.packs = 1
  const printed = preparePrintableShoppingChecklist(source).lines.find((item) => item.id === line.id)
  assert.ok(printed)
  assert.equal(printed.needsReview, false)
  assert.equal(printed.quantity, '1 verpakking van 2 × 300 g')
  assert.doesNotMatch(printed.quantity, /1 verpakkingen/)
})

test('multipacks show both outer packages and real inner physical units', () => {
  const source = structuredClone(basket())
  const line = source.lines.find((line) => line.status === 'matched')
  assert.ok(line)
  line.requirement.amount = 1200
  line.pack.amount = 200
  line.pack.unit = 'g'
  line.pack.count = 2
  line.packs = 3
  const result = preparePrintableShoppingChecklist(source)
  assert.match(result.lines.find((item) => item.id === line.id).quantity, /^3 verpakkingen van 2 × /)
})

test('invalid matched physical quantities fail closed to a manual check', () => {
  for (const value of [0, -1, 2.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    const source = structuredClone(basket())
    const line = source.lines.find((item) => item.status === 'matched')
    assert.ok(line)
    line.packs = value
    const result = preparePrintableShoppingChecklist(source)
    const printed = result.lines.find((item) => item.id === line.id)
    assert.equal(printed.needsReview, true)
    assert.match(printed.quantity, /handmatig kiezen/)
  }
})


test('stale excessive packs or incompatible units never become a purchase instruction', () => {
  const original = basket()
  for (const mutate of [
    (line) => { line.packs += 1 },
    (line) => { line.pack.unit = 'ml' },
    (line) => { line.pack.count = 0 },
  ]) {
    const source = structuredClone(original)
    const line = source.lines.find((item) => item.status === 'matched')
    assert.ok(line)
    mutate(line)
    const result = preparePrintableShoppingChecklist(source)
    const printed = result.lines.find((item) => item.id === line.id)
    assert.equal(printed.needsReview, true)
    assert.match(printed.quantity, /handmatig kiezen/)
  }
})

test('empty planned week prints an honest empty list', () => {
  const result = preparePrintableShoppingChecklist(basket(m2Products, []))
  assert.equal(result.lines.length, 0)
  assert.equal(result.reviewCount, 0)
})

test('duplicate and invisible-only identifiers fail closed rather than printing ambiguous tasks', () => {
  const original = basket()
  for (const source of [
    { ...original, lines: [...original.lines, original.lines[0]] },
    { ...original, lines: [{ ...original.lines[0], id: '\u200b\u0301' }, ...original.lines.slice(1)] },
  ]) {
    assert.throws(() => preparePrintableShoppingChecklist(source), /Dubbele of ongeldige/)
  }
})
