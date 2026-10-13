import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'

function basket(products = m2Products) {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products,
  })
}

function withMatchedLine(mutator) {
  const source = structuredClone(basket())
  const line = source.lines.find((item) => item.status === 'matched')
  assert.ok(line, 'canonical M2 fixture unexpectedly has no matched basket line')
  mutator(line)
  return { source, id: line.id }
}

test('canonical 11-line projection is price-free, sorted identically, and detached from source', () => {
  const source = basket()
  const before = structuredClone(source)
  const printed = preparePrintableShoppingChecklist(source)
  assert.equal(printed.lines.length, source.lines.length)
  assert.deepEqual(printed.lines.map((line) => line.id), source.lines.map((line) => line.id))
  assert.deepEqual(source, before)
  assert.equal(printed.reviewCount, printed.lines.filter((line) => line.needsReview).length)
  assert.ok(printed.lines.every((line) => typeof line.label === 'string' && line.label.length > 0))
  assert.ok(printed.lines.every((line) => !Object.hasOwn(line, 'priceCents') && !Object.hasOwn(line, 'lineTotalCents')))
  const serialized = JSON.stringify(printed)
  assert.doesNotMatch(serialized, /(?:pricePerPackCents|totalCents|savingsCents|observedAt|evidenceId|participantKey|publicSavingsClaimEligible)/)
  assert.equal(printed.isDemo, true)
  if (source.lines[0]?.status === 'matched') source.lines[0].productName = 'MUTATED LATER'
  assert.doesNotMatch(JSON.stringify(printed), /MUTATED LATER/)
})

test('equivalent mass, volume and piece multipacks remain physically minimal across units', () => {
  for (const [requiredAmount, requiredUnit, packAmount, packUnit, count, outerPacks, display] of [
    [1200, 'g', 0.5, 'kg', 1, 3, '3 × 0.5 kg'],
    [1.2, 'kg', 500, 'g', 1, 3, '3 × 500 g'],
    [750, 'ml', 0.5, 'l', 2, 1, '1 verpakkingen van 2 × 0.5 l'],
    [2.5, 'l', 250, 'ml', 2, 5, '5 verpakkingen van 2 × 250 ml'],
    [6, 'piece', 2, 'piece', 2, 2, '2 verpakkingen van 2 × 2 stuks'],
  ]) {
    const { source, id } = withMatchedLine((line) => {
      line.requirement = { amount: requiredAmount, unit: requiredUnit }
      line.pack = { amount: packAmount, unit: packUnit, count }
      line.packs = outerPacks
    })
    const result = preparePrintableShoppingChecklist(source)
    const projected = result.lines.find((line) => line.id === id)
    assert.equal(projected?.needsReview, false, display)
    assert.equal(projected?.quantity, display)
  }
})

test('underbuy, overbuy, broken packs and incompatible units never become trusted purchase instructions', () => {
  const mutators = [
    (line) => { line.requirement = { amount: 1200, unit: 'g' }; line.pack = { amount: 500, unit: 'g', count: 1 }; line.packs = 2 },
    (line) => { line.requirement = { amount: 1200, unit: 'g' }; line.pack = { amount: 500, unit: 'g', count: 1 }; line.packs = 4 },
    (line) => { line.pack.count = -1 },
    (line) => { line.pack.count = 1.5 },
    (line) => { line.pack.count = Number.NaN },
    (line) => { line.pack.amount = 0 },
    (line) => { line.pack.amount = Number.POSITIVE_INFINITY },
    (line) => { line.pack.amount = -0.01 },
    (line) => { line.requirement.amount = 0 },
    (line) => { line.requirement.amount = Number.POSITIVE_INFINITY },
    (line) => { line.requirement.unit = 'unknown' },
    (line) => { line.pack.unit = 'unknown' },
    (line) => { line.pack.unit = 'ml' },
    (line) => { line.packs = Number.MAX_SAFE_INTEGER + 1 },
  ]
  for (const [index, mutate] of mutators.entries()) {
    const { source, id } = withMatchedLine(mutate)
    const result = preparePrintableShoppingChecklist(source)
    const projected = result.lines.find((line) => line.id === id)
    assert.equal(projected?.needsReview, true, `variant ${index} printed untrusted quantity`)
    assert.match(projected.quantity, /handmatig kiezen/)
    assert.equal(result.reviewCount, result.lines.filter((line) => line.needsReview).length)
  }
})

test('one absent product changes only its own row to manual review, never fabricates a substitute', () => {
  const original = basket()
  const missing = basket(m2Products.filter((product) => product.id !== 'chicken-400'))
  const originalChecklist = preparePrintableShoppingChecklist(original)
  const missingChecklist = preparePrintableShoppingChecklist(missing)
  assert.deepEqual(originalChecklist.lines.map((row) => row.id), missingChecklist.lines.map((row) => row.id))
  const changed = originalChecklist.lines.filter((row, index) =>
    JSON.stringify(row) !== JSON.stringify(missingChecklist.lines[index]))
  assert.equal(changed.length, 1)
  assert.equal(changed[0].id, 'chicken-thigh')
  const affected = missingChecklist.lines.find((row) => row.id === 'chicken-thigh')
  assert.equal(affected.needsReview, true)
  assert.equal(affected.label, 'Kippendij')
  assert.match(affected.quantity, /handmatig kiezen/)
  assert.ok(missingChecklist.reviewCount >= originalChecklist.reviewCount)
})

test('invisible-only store and ingredient display labels downgrade to explicit human-facing unknown', () => {
  const source = structuredClone(basket())
  source.store = { id: 'non-demo-store', name: '\u200b\u0301' }
  const first = source.lines[0]
  first.status = 'unresolved'
  first.ingredientLabel = '\u200b\u0301'
  first.requirement = { amount: null, unit: 'unknown' }
  const printed = preparePrintableShoppingChecklist(source)
  assert.equal(printed.storeLabel, 'Winkel nog te kiezen')
  assert.equal(printed.isDemo, false)
  assert.equal(printed.lines[0].label, 'Onbekend ingrediënt')
  assert.equal(printed.lines[0].needsReview, true)
  assert.equal(printed.lines[0].quantity, 'hoeveelheid onbekend · handmatig kiezen')
})

test('a cloned projection does not mutate input despite repeated unknown-to-known flips', () => {
  const source = basket()
  const frozen = structuredClone(source)
  const output = preparePrintableShoppingChecklist(source)
  const repeat = preparePrintableShoppingChecklist(structuredClone(source))
  assert.deepEqual(output, repeat)
  assert.deepEqual(source, frozen)
  output.lines[0].label = 'CHANGED OUTPUT'
  assert.deepEqual(source, frozen)
  assert.notEqual(preparePrintableShoppingChecklist(source).lines[0].label, 'CHANGED OUTPUT')
})
