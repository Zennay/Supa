import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2Store, m2InitialPlan, m2Recipes, m2Products, m2DefaultActiveDays } from '../src/data/m2Fixture.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'

function basket() {
  return structuredClone(buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    products: m2Products, activeDays: m2DefaultActiveDays,
  }))
}

test('Dutch paper list shows comma decimals while preserving physical pack arithmetic', () => {
  const source = basket()
  const line = source.lines.find(row => row.status === 'matched')
  assert.ok(line)
  line.requirement = { amount: 0.6, unit: 'kg' }
  line.pack = { amount: 0.2, unit: 'kg', count: 1 }
  line.packs = 3
  const before = structuredClone(source)
  const result = preparePrintableShoppingChecklist(source).lines.find(row => row.id === line.id)
  assert.ok(result)
  assert.equal(result.needsReview, false)
  assert.equal(result.quantity, '3 × 0,2 kg')
  assert.deepEqual(source, before)

  line.status = 'unresolved'
  line.requirement = { amount: 0.75, unit: 'l' }
  const pending = preparePrintableShoppingChecklist(source).lines.find(row => row.id === line.id)
  assert.ok(pending.needsReview)
  assert.equal(pending.quantity, '0,75 l · handmatig kiezen')
  assert.doesNotMatch(pending.quantity, /€|besparing|prijsverschil/i)
})

test('controlled line breaks and bidi markers separate printed words instead of merging them', () => {
  const source = basket()
  source.store.name = 'PLUS\u202e Leiden\nCentrum'
  const line = source.lines.find(row => row.status === 'matched')
  assert.ok(line)
  line.productName = 'Rijst\n[x] Extra'
  const before = structuredClone(source)
  const printed = preparePrintableShoppingChecklist(source)
  const item = printed.lines.find(row => row.id === line.id)
  assert.equal(printed.storeLabel, 'PLUS Leiden Centrum')
  assert.equal(item.label, 'Rijst [x] Extra')
  assert.equal(item.needsReview, false)
  assert.doesNotMatch(JSON.stringify(printed), /[\u0000-\u001f\u200b\u202e\u2028\u2029]/u)
  assert.deepEqual(source, before)
})

test('whole-number packages and true unavailable quantities do not change', () => {
  const source = basket()
  const original = preparePrintableShoppingChecklist(source)
  const changed = structuredClone(source)
  const matched = changed.lines.find(row => row.status === 'matched')
  assert.ok(matched)
  matched.status = 'unresolved'
  matched.requirement.amount = null
  const printed = preparePrintableShoppingChecklist(changed)
  assert.ok(printed.lines.some(row => row.quantity === 'hoeveelheid onbekend · handmatig kiezen'))
  assert.ok(original.lines.some(row => row.quantity.includes(' × 1 stuk')))
})
