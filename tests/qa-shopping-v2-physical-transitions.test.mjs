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
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import {
  reconcileShoppingProgressV2,
  restoreShoppingProgressV2,
  serializeShoppingProgressV2,
  toggleShoppingProgressV2,
} from '../src/features/shopping-list/shoppingListProgressV2.ts'

const weeks = [['Ma'], ['Di'], ['Wo'], ['Ma', 'Di'], ['Di', 'Wo'], m2DefaultActiveDays]

function basket(activeDays, products = m2Products) {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays,
    products,
  })
}

function changed(original, mutate) {
  const copy = structuredClone(original)
  mutate(copy)
  return copy
}

function assertTransition(before, after, completed, expected, context) {
  const snapshot = JSON.stringify(before)
  const afterSnapshot = JSON.stringify(after)
  const saved = serializeShoppingProgressV2(before, completed)
  assert.ok(saved, context)
  assert.deepEqual(restoreShoppingProgressV2(after, saved), expected, context)
  assert.deepEqual(reconcileShoppingProgressV2(before, after, completed), expected, context)
  assert.equal(JSON.stringify(before), snapshot, 'checking must not alter initial basket')
  assert.equal(JSON.stringify(after), afterSnapshot, 'checking must not alter updated basket')
}

test('physical task identity is stable for all canonical weeks across combined repricing, label drift and row reorder', () => {
  let checkedWeeks = 0

  for (const days of weeks) {
    const before = basket(days)
    assert.ok(before.lines.length > 0)
    const completed = before.lines.slice(0, 2).map((line) => line.id)
    const repriced = basket(days, m2Products.map((product) => ({
      ...product,
      priceCents: product.priceCents + 1,
    })))
    assert.notEqual(before.totalCents, repriced.totalCents)

    const after = changed(repriced, (copy) => {
      copy.lines.reverse()
      for (const line of copy.lines) {
        line.ingredientLabel += ' (vernieuwde tekst)'
        line.reasons = ['andere toelichting']
        if (line.status === 'matched') {
          line.productName += ' nieuwe verpakkingstekst'
          line.matchScore = 100
        }
      }
    })

    assert.equal(shoppingListDemandIdentity(before), shoppingListDemandIdentity(after))
    assertTransition(before, after, completed, completed, days.join(','))
    assert.deepEqual(toggleShoppingProgressV2(after, completed, completed[0]), completed.slice(1))
    checkedWeeks++
  }

  assert.equal(checkedWeeks, weeks.length)
})

test('each changed physical purchase dimension invalidates both persisted and in-session checks', () => {
  let verified = 0
  for (const days of weeks) {
    const before = basket(days)
    assert.ok(shoppingListDemandIdentity(before))
    const completed = before.lines.slice(0, 2).map((line) => line.id)

    for (let index = 0; index < before.lines.length; index++) {
      const originalLine = before.lines[index]
      const changes = [
        ['ingredient amount', (line) => { line.requirement.amount = (line.requirement.amount ?? 0) + 1 }],
        ['ingredient unit', (line) => { line.requirement.unit = line.requirement.unit === 'g' ? 'kg' : 'g' }],
        ['status', (line) => { line.status = line.status === 'matched' ? 'unresolved' : 'matched' }],
      ]
      if (originalLine.status === 'matched') {
        changes.push(
          ['selected product', (line) => { line.productId += '-different' }],
          ['whole packs', (line) => { line.packs += 1 }],
          ['pack amount', (line) => { line.pack.amount += 1 }],
          ['pack count', (line) => { line.pack.count += 1 }],
          ['pack unit', (line) => { line.pack.unit = line.pack.unit === 'g' ? 'kg' : 'g' }],
        )
      }

      for (const [label, mutate] of changes) {
        const after = changed(before, (copy) => mutate(copy.lines[index]))
        const note = `${days.join(',')} / ${originalLine.id} / ${label}`
        assert.notEqual(shoppingListDemandIdentity(before), shoppingListDemandIdentity(after), note)
        assertTransition(before, after, completed, [], note)
        verified++
      }
    }

    const otherStore = changed(before, (copy) => { copy.store.id += '-other' })
    assertTransition(before, otherStore, completed, [], 'store switch')
    const removed = changed(before, (copy) => { copy.lines.pop() })
    assertTransition(before, removed, completed, [], 'removed line')
  }
  assert.ok(verified > 50, 'exercise a meaningful matrix of purchase changes')
})

test('unresolved-to-resolved product state and failed restoration never resurrect stale ticks', () => {
  const days = ['Di']
  const complete = basket(days)
  const completed = complete.lines.map((line) => line.id)
  const selected = complete.lines.find((line) => line.status === 'matched')
  assert.ok(selected)

  const incomplete = basket(days, m2Products.filter((product) => product.id !== selected.productId))
  const unresolved = incomplete.lines.find((line) => line.id === selected.id)
  assert.ok(unresolved)
  assert.equal(unresolved.status, 'unresolved')
  assertTransition(complete, incomplete, completed, [], 'product became unavailable')
  assertTransition(incomplete, complete, [selected.id], [], 'product became available')

  const raw = serializeShoppingProgressV2(complete, completed)
  assert.ok(raw)
  const decoded = JSON.parse(raw)
  const invalidRecords = [
    { ...decoded, schemaVersion: '2' },
    { ...decoded, demandIdentity: JSON.stringify({}) },
    { ...decoded, doneLineIds: null },
    { ...decoded, doneLineIds: 'stale' },
  ]
  for (const invalid of invalidRecords) {
    assert.deepEqual(restoreShoppingProgressV2(complete, JSON.stringify(invalid)), [])
  }

  const mixed = { ...decoded, doneLineIds: [selected.id, selected.id, 'foreign-id', null] }
  assert.deepEqual(restoreShoppingProgressV2(complete, JSON.stringify(mixed)), [selected.id])
  assert.deepEqual(toggleShoppingProgressV2(complete, [selected.id], 'foreign-id'), [selected.id])
})
