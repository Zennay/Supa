import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2Store, m2InitialPlan, m2Recipes, m2Products, m2DefaultActiveDays,
} from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

function basket(activeDays = m2DefaultActiveDays) {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays, products: m2Products,
  })
}

function revoked(value) {
  const pair = Proxy.revocable(value, {})
  pair.revoke()
  return pair.proxy
}

test('postrepair: nested revoked store object cannot abort render', () => {
  const current = basket()
  assert.equal(buildShoppingListCopyText({ ...current, store: revoked({ ...current.store }) }), null)
})

test('postrepair: nested revoked matched line cannot abort render', () => {
  const current = basket()
  const lines = [...current.lines]
  lines[0] = revoked({ ...lines[0] })
  assert.equal(buildShoppingListCopyText({ ...current, lines }), null)
})

test('postrepair: nested revoked pack cannot abort render', () => {
  const current = basket()
  const lines = current.lines.map(line =>
    line.status === 'matched' ? { ...line, pack: revoked({ ...line.pack }) } : line)
  assert.equal(buildShoppingListCopyText({ ...current, lines }), null)
})

test('postrepair: malicious line array indexed getter cannot abort render', () => {
  const current = basket()
  const lines = [...current.lines]
  Object.defineProperty(lines, '0', { get() { throw Error('line read') } })
  assert.equal(buildShoppingListCopyText({ ...current, lines }), null)
})

test('postrepair: malicious completed-ID indexed getter cannot abort render', () => {
  const done = ['chicken-thigh']
  Object.defineProperty(done, '0', { get() { throw Error('checkmark read') } })
  assert.equal(buildShoppingListCopyText(basket(), done), null)
})

test('postrepair: malicious pack-count getter cannot produce a partial list', () => {
  const current = basket()
  const lines = current.lines.map(line => line.status !== 'matched' ? line : {
    ...line,
    pack: { ...line.pack, get count() { throw Error('pack read') } },
  })
  assert.equal(buildShoppingListCopyText({ ...current, lines }), null)
})

test('postrepair: valid copied and checked lists stay stable after malformed attempt', () => {
  const current = basket()
  const original = JSON.stringify(current)
  const copied = buildShoppingListCopyText(current, ['chicken-thigh'])
  assert.ok(copied)
  assert.match(copied, /\[x\]/)
  assert.match(copied, /product zelf kiezen/)
  assert.doesNotMatch(copied, /€|besparing|prijsverschil/i)
  assert.equal(buildShoppingListCopyText(current, ['unknown-line']), null)
  assert.equal(buildShoppingListCopyText(current, ['chicken-thigh']), copied)
  assert.equal(JSON.stringify(current), original)
})

test('postrepair: empty week retains truthful no-shopping copy', () => {
  const text = buildShoppingListCopyText(basket([]))
  assert.ok(text)
  assert.match(text, /nog geen boodschappen gepland/)
  assert.doesNotMatch(text, /\[x\]|\[ \]|€/)
})
