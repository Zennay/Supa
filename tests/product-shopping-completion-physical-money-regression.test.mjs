import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListCompletion } from '../src/features/shopping-list/shoppingListCompletion.ts'

// Synthetic M2 data only. This is not proof of retailer prices or actual purchases.
function basket() {
  const result = buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: ['Di'],
    products: m2Products,
  })
  assert.equal(result.unresolvedLineCount, 0)
  assert.ok(result.lines.length >= 3)
  return result
}

function replaceLine(source, id, edit) {
  const line = source.lines.find((item) => item.id === id)
  assert.ok(line && line.status === 'matched', `expected canonical match: ${id}`)
  return {
    ...source,
    lines: source.lines.map((item) => item.id === id ? edit(structuredClone(line)) : item),
  }
}

function assertInvalid(source, label) {
  const before = structuredClone(source)
  for (const done of [[], source.lines.map((line) => line.id)]) {
    const progress = shoppingListCompletion(source, done)
    assert.equal(progress.state, 'invalid', label)
    assert.equal(progress.checkedCount, 0, label)
    assert.doesNotMatch(progress.message, /Alle boodschappen afgevinkt\./)
  }
  assert.deepEqual(source, before, `${label} must not mutate inputs`)
}

test('canonical current-week basket supports checked progress and immutable exact totals', () => {
  const value = basket()
  const checked = value.lines.map((line) => line.id)
  assert.equal(shoppingListCompletion(value, checked).state, 'complete')
  assert.equal(shoppingListCompletion(value, []).state, 'in-progress')
  assert.equal(value.totalCents, value.lines.reduce((sum, line) =>
    sum + (line.status === 'matched' ? line.lineTotalCents : 0), 0))
})

test('unit conversion honours g/kg, ml/l, exact boundaries and legitimate multipacks', () => {
  const source = basket()
  const equivalent = {
    ...source,
    lines: source.lines.map((line) => {
      if (line.id === 'basmati-rice' && line.status === 'matched') {
        return { ...line, pack: { ...line.pack, amount: 150, unit: 'g' } }
      }
      if (line.id === 'teriyaki-sauce' && line.status === 'matched') {
        return { ...line, pack: { ...line.pack, amount: 0.03, unit: 'l', count: 2 } }
      }
      return line
    }),
  }
  assert.equal(shoppingListCompletion(equivalent, equivalent.lines.map((line) => line.id)).state, 'complete')
})

test('physical demand, pack shrinkage and mismatched families fail before progress', () => {
  const original = basket()
  const bad = [
    replaceLine(original, 'basmati-rice', (l) => ({ ...l, requirement: { ...l.requirement, amount: 1001 } })),
    replaceLine(original, 'teriyaki-sauce', (l) => ({ ...l, requirement: { ...l.requirement, amount: 251 } })),
    replaceLine(original, 'basmati-rice', (l) => ({ ...l, pack: { ...l.pack, amount: 0.05 } })),
    replaceLine(original, 'teriyaki-sauce', (l) => ({ ...l, pack: { ...l.pack, amount: 10 } })),
    replaceLine(original, 'basmati-rice', (l) => ({ ...l, pack: { ...l.pack, unit: 'l' } })),
    replaceLine(original, 'teriyaki-sauce', (l) => ({ ...l, pack: { ...l.pack, unit: 'kg' } })),
    replaceLine(original, 'basmati-rice', (l) => ({ ...l, pack: { ...l.pack, unit: 'piece' } })),
  ]
  bad.forEach((item, index) => assertInvalid(item, `physical mutation ${index}`))
})

test('extra packs are not canonical even when matching line and basket cents were adjusted', () => {
  const original = basket()
  const line = original.lines.find((item) => item.id === 'basmati-rice')
  assert.equal(line?.status, 'matched')
  const forged = replaceLine(original, 'basmati-rice', (l) => ({
    ...l,
    packs: l.packs + 1,
    lineTotalCents: (l.packs + 1) * l.pricePerPackCents,
  }))
  forged.totalCents += line.pricePerPackCents
  assertInvalid(forged, 'extra packages are not backed by demand')
})

test('all malformed basket totals and unreconciled but safe integers fail closed', () => {
  const original = basket()
  for (const totalCents of [
    undefined, null, String(original.totalCents), Number.NaN, Infinity,
    -1, original.totalCents + 0.5, Number.MAX_SAFE_INTEGER + 1,
    original.totalCents + 1,
  ]) {
    assertInvalid({ ...original, totalCents }, `untrusted total ${String(totalCents)}`)
  }
})

test('internally consistent zero-cent product baskets are valid, not missing-price evidence', () => {
  const original = basket()
  const zeroCost = {
    ...original,
    totalCents: 0,
    lines: original.lines.map((line) => line.status === 'matched'
      ? { ...line, pricePerPackCents: 0, lineTotalCents: 0 }
      : line),
  }
  assert.equal(shoppingListCompletion(zeroCost, zeroCost.lines.map((line) => line.id)).state, 'complete')
})
