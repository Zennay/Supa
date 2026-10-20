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
import { shoppingListBasketKey } from '../src/features/shopping-list/shoppingListProgress.ts'

function basket(activeDays = m2DefaultActiveDays, products = m2Products) {
  return buildOneStoreBasket({
    store: m2Store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays,
    products,
  })
}

function changeLine(original, mutate) {
  const changed = structuredClone(original)
  const line = changed.lines.find((candidate) => candidate.status === 'matched')
  assert.ok(line, 'canonical basket must have a matched line')
  mutate(line)
  return changed
}

test('price-only refresh retains physical shopping identity, without changing legacy v1 semantics', () => {
  const before = basket(['Di'])
  const chosen = before.lines.find((line) => line.status === 'matched')
  assert.ok(chosen)
  const reprice = m2Products.map((product) =>
    product.id === chosen.productId
      ? { ...product, priceCents: product.priceCents + 1 }
      : product,
  )
  const after = basket(['Di'], reprice)
  assert.notEqual(after.totalCents, before.totalCents)
  assert.notEqual(shoppingListBasketKey(before), shoppingListBasketKey(after))
  assert.equal(shoppingListDemandIdentity(before), shoppingListDemandIdentity(after))
})

test('changing only presentation labels or price trace never unchecks a physical item', () => {
  const before = basket(['Di'])
  const after = changeLine(before, (line) => {
    line.ingredientLabel += ' (aangepast)'
    line.productName += ' aanbieding'
    line.pricePerPackCents += 17
    line.lineTotalCents += 17 * line.packs
    line.reasons = ['nieuwe prijsbron']
    line.matchScore = 99
  })
  assert.equal(shoppingListDemandIdentity(before), shoppingListDemandIdentity(after))
})

test('store, product, quantity, pack or match transition forces new shopping identity', () => {
  const before = basket(['Di'])
  const identity = shoppingListDemandIdentity(before)
  assert.ok(identity)
  const otherShop = structuredClone(before)
  otherShop.store.id = 'different-store'
  assert.notEqual(shoppingListDemandIdentity(otherShop), identity)

  for (const mutate of [
    (line) => { line.productId += '-different' },
    (line) => { line.requirement.amount += 1 },
    (line) => { line.packs += 1 },
    (line) => { line.pack.amount += 1 },
    (line) => { line.pack.count += 1 },
    (line) => { line.pack.unit = line.pack.unit === 'g' ? 'kg' : 'g' },
    (line) => { line.status = 'unresolved' },
  ]) {
    assert.notEqual(shoppingListDemandIdentity(changeLine(before, mutate)), identity)
  }
})

test('different active demands or lines reset completion, but display reorder is safe', () => {
  const before = basket(['Di'])
  const identity = shoppingListDemandIdentity(before)
  assert.ok(identity)
  assert.notEqual(shoppingListDemandIdentity(basket(['Di', 'Wo'])), identity)
  const removed = structuredClone(before)
  removed.lines.pop()
  assert.notEqual(shoppingListDemandIdentity(removed), identity)

  if (before.lines.length > 1) {
    const reordered = structuredClone(before)
    reordered.lines.reverse()
    assert.equal(shoppingListDemandIdentity(reordered), identity)
  }
})

test('empty planned weeks have a deterministic but distinct empty task identity', () => {
  const empty = basket([])
  assert.deepEqual(empty.lines, [])
  const key = shoppingListDemandIdentity(empty)
  assert.ok(key)
  assert.notEqual(key, shoppingListDemandIdentity(basket(['Di'])))
  assert.equal(key, shoppingListDemandIdentity(basket([])))
})

test('invalid runtime baskets fail closed instead of colliding on JSON nulls', () => {
  const before = basket(['Di'])
  const malformed = [
    null,
    {},
    { ...before, store: { id: ' ' } },
    { ...before, lines: null },
    { ...before, lines: [null] },
    { ...before, lines: [before.lines[0], before.lines[0]] },
    changeLine(before, (line) => { line.requirement.amount = Number.NaN }),
    changeLine(before, (line) => { line.requirement.amount = Infinity }),
    changeLine(before, (line) => { line.pack.count = 0 }),
    changeLine(before, (line) => { line.packs = Number.MAX_SAFE_INTEGER + 1 }),
    changeLine(before, (line) => { line.productId = '' }),
    changeLine(before, (line) => { line.pack.unit = 'unknown' }),
    changeLine(before, (line) => { line.requirement.unit = { toString: () => 'g' } }),
    changeLine(before, (line) => { line.pack.unit = { toString: () => 'g' } }),
    changeLine(before, (line) => { line.requirement.unit = 12 }),
    changeLine(before, (line) => { line.pack.unit = 12 }),
    changeLine(before, (line) => { line.status = 'incomplete' }),
  ]

  for (const input of malformed) {
    assert.equal(shoppingListDemandIdentity(input), null)
  }
})

test('identity calculation does not mutate frozen basket inputs', () => {
  const before = basket(['Di'])
  Object.freeze(before)
  Object.freeze(before.store)
  Object.freeze(before.lines)
  for (const line of before.lines) {
    Object.freeze(line)
    Object.freeze(line.requirement)
    if (line.status === 'matched') Object.freeze(line.pack)
  }
  assert.equal(shoppingListDemandIdentity(before), shoppingListDemandIdentity(before))
})
