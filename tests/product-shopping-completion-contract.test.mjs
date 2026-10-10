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
import { shoppingListCompletion } from '../src/features/shopping-list/shoppingListCompletion.ts'

function fixture() {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: m2Products,
  })
}

function matchedBasket() {
  const source = fixture()
  const line = source.lines.find((item) => item.status === 'matched')
  assert.ok(line, 'fixture contains a match')
  return {
    ...source,
    lines: [line],
    matchedLineCount: 1,
    unresolvedLineCount: 0,
  }
}

function openBasket() {
  const source = matchedBasket()
  const unresolved = {
    id: 'missing-demo-ingredient',
    ingredientLabel: 'Nog te kiezen',
    requirement: { amount: null, unit: 'g' },
    status: 'unresolved',
    reasons: ['no candidates'],
    matchScore: null,
  }
  return {
    ...source,
    lines: [...source.lines, unresolved],
    unresolvedLineCount: 1,
  }
}

test('current matched item reports progress, ignores duplicates and unknown saved IDs', () => {
  const basket = matchedBasket()
  const lineId = basket.lines[0].id
  const original = JSON.stringify(basket)

  assert.deepEqual(shoppingListCompletion(basket, []), {
    state: 'in-progress',
    checkedCount: 0,
    totalCount: 1,
    remainingCount: 1,
    unresolvedCount: 0,
    message: '0 van 1 boodschappen afgevinkt.',
    followUp: null,
  })
  assert.deepEqual(shoppingListCompletion(basket, [lineId, lineId, 'stale', 42]), {
    state: 'complete',
    checkedCount: 1,
    totalCount: 1,
    remainingCount: 0,
    unresolvedCount: 0,
    message: 'Alle boodschappen afgevinkt.',
    followUp: null,
  })
  assert.equal(JSON.stringify(basket), original, 'input basket is immutable')
})

test('checking an unresolved line can never turn the list into a trustworthy complete state', () => {
  const basket = openBasket()
  const allIds = basket.lines.map((line) => line.id)
  const initial = shoppingListCompletion(basket, [basket.lines[0].id])
  assert.equal(initial.state, 'in-progress')
  assert.equal(initial.unresolvedCount, 1)
  assert.equal(initial.followUp, '1 productkeuze vraagt nog jouw controle.')

  const allChecked = shoppingListCompletion(basket, allIds)
  assert.equal(allChecked.state, 'review-needed')
  assert.equal(allChecked.checkedCount, 2)
  assert.equal(allChecked.remainingCount, 0)
  assert.equal(allChecked.followUp, '1 productkeuze vraagt nog jouw controle.')
  assert.doesNotMatch(allChecked.message, /alle boodschappen afgevinkt\./i)
})

test('unresolved items still require review even if there are no matched items', () => {
  const source = openBasket()
  const basket = {
    ...source,
    lines: source.lines.slice(1),
    matchedLineCount: 0,
    unresolvedLineCount: 1,
  }
  assert.equal(shoppingListCompletion(basket, [basket.lines[0].id]).state, 'review-needed')
  assert.equal(shoppingListCompletion(basket, []).state, 'in-progress')
})

test('empty active week and zero-line recipe show neutral empty copy without a purchase claim', () => {
  const empty = buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: [],
    products: m2Products,
  })
  const actual = shoppingListCompletion(empty, ['untrusted'])
  assert.equal(actual.state, 'empty')
  assert.equal(actual.totalCount, 0)
  assert.match(actual.message, /Geen boodschappenregels/)
  assert.equal(shoppingListCompletion({ ...empty, selectedMealCount: 1 }, []).state, 'empty')
})

test('unknown or malformed checkmark state never manufactures checked items', () => {
  const basket = matchedBasket()
  for (const value of [undefined, null, {}, 'checked', 10, [null, {}, false]]) {
    const result = shoppingListCompletion(basket, value)
    assert.equal(result.state, 'in-progress')
    assert.equal(result.checkedCount, 0)
  }
})

test('tampered list, duplicate identity, counters and malformed packs fail closed', () => {
  const original = matchedBasket()
  const line = original.lines[0]
  const corrupt = [
    { ...original, lines: {} },
    { ...original, matchedLineCount: 0 },
    { ...original, unresolvedLineCount: 1 },
    { ...original, matchedLineCount: Number.NaN },
    { ...original, selectedMealCount: -1 },
    { ...original, lines: [line, line], matchedLineCount: 2 },
    { ...original, lines: [{ ...line, id: ' ' }] },
    { ...original, lines: [{ ...line, status: 'unknown' }] },
    { ...original, lines: [{ ...line, packs: 0 }] },
    { ...original, lines: [{ ...line, pack: null }] },
    { ...original, lines: [{ ...line, pack: { ...line.pack, count: Infinity } }] },
    { ...original, lines: [{ ...line, productName: '' }] },
    { ...original, lines: [{ ...line, lineTotalCents: -1 }] },
  ]
  for (const basket of corrupt) {
    const result = shoppingListCompletion(basket, [line.id])
    assert.equal(result.state, 'invalid', JSON.stringify(basket))
    assert.equal(result.checkedCount, 0)
    assert.doesNotMatch(result.message, /klaar|Alle boodschappen afgevinkt/i)
  }
})

test('reordered and repriced basket lines alone do not alter current checked-ID counts', () => {
  const basket = fixture()
  const picked = basket.lines.find((line) => line.status === 'matched')
  assert.ok(picked)
  const repriced = {
    ...basket,
    lines: basket.lines.map((line) =>
      line.id === picked.id && line.status === 'matched'
        ? { ...line, lineTotalCents: line.lineTotalCents + 1 }
        : line,
    ).reverse(),
  }
  const before = shoppingListCompletion(basket, [picked.id])
  const after = shoppingListCompletion(repriced, [picked.id])
  assert.equal(after.checkedCount, before.checkedCount)
  assert.equal(after.totalCount, before.totalCount)
  assert.equal(after.unresolvedCount, before.unresolvedCount)
  assert.notEqual(after.state, 'invalid')
})
