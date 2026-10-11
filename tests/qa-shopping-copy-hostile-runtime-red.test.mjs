import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2Store, m2InitialPlan, m2Recipes, m2Products, m2DefaultActiveDays,
} from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

function basket() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  })
}

function revoked(value) {
  const { proxy, revoke } = Proxy.revocable(value, {})
  revoke()
  return proxy
}

test('valid shopping copy remains price-independent and immutable [control]', () => {
  const original = basket()
  const before = JSON.stringify(original)
  const copied = buildShoppingListCopyText(original, ['chicken-thigh'])
  assert.ok(copied)
  assert.match(copied, /\[x\].*Kip|\[x\]/)
  assert.doesNotMatch(copied, /€|besparing|korting/i)
  assert.equal(JSON.stringify(original), before)
})

test('malformed root store accessor must abstain instead of throwing [RED]', () => {
  const current = basket()
  const malformed = { ...current, get store() { throw Error('store unavailable') } }
  assert.equal(buildShoppingListCopyText(malformed), null)
})

test('malformed store name accessor must abstain instead of throwing [RED]', () => {
  const current = basket()
  const malformed = {
    ...current,
    store: { ...current.store, get name() { throw Error('name unavailable') } },
  }
  assert.equal(buildShoppingListCopyText(malformed), null)
})

test('malformed line property accessor must abstain instead of throwing [RED]', () => {
  const current = basket()
  const malformed = {
    ...current,
    lines: [
      { ...current.lines[0], get ingredientLabel() { throw Error('line unavailable') } },
      ...current.lines.slice(1),
    ],
  }
  assert.equal(buildShoppingListCopyText(malformed), null)
})

test('malformed requirement amount accessor must abstain instead of throwing [RED]', () => {
  const current = basket()
  const malformed = {
    ...current,
    lines: [{
      ...current.lines[0],
      requirement: {
        ...current.lines[0].requirement,
        get amount() { throw Error('quantity unavailable') },
      },
    }, ...current.lines.slice(1)],
  }
  assert.equal(buildShoppingListCopyText(malformed), null)
})

test('revoked root basket proxy must abstain instead of throwing [RED]', () => {
  assert.equal(buildShoppingListCopyText(revoked(basket())), null)
})

test('revoked basket lines Array proxy must abstain instead of throwing [RED]', () => {
  const current = basket()
  assert.equal(buildShoppingListCopyText({ ...current, lines: revoked([...current.lines]) }), null)
})

test('revoked completed-ID Array proxy must abstain instead of throwing [RED]', () => {
  assert.equal(buildShoppingListCopyText(basket(), revoked(['chicken-thigh'])), null)
})

test('throwing completed-ID iterator must abstain without partial checklist [RED]', () => {
  const completed = ['chicken-thigh']
  Object.defineProperty(completed, Symbol.iterator, {
    get() { throw Error('iterator unavailable') },
  })
  assert.equal(buildShoppingListCopyText(basket(), completed), null)
})
