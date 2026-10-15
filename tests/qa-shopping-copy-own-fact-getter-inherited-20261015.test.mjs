import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

// Copying to another app is an explicit user action, but the exported words
// still must be derived only from the same basket's own, inert data facts.
// This suite neither touches the clipboard nor requests real retailer data.
function basket() {
  return structuredClone(buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    products: m2Products, activeDays: m2DefaultActiveDays,
  }))
}
function matched(source) {
  const row = source.lines.find(line => line.status === 'matched')
  assert.ok(row)
  return row
}
function accessor(object, field, value) {
  let calls = 0
  Object.defineProperty(object, field, {
    enumerable: true, configurable: true,
    get() { calls++; return value },
  })
  return () => calls
}
function inherited(object, field, value) {
  delete object[field]
  Object.setPrototypeOf(object, { [field]: value })
}

test('copy control: canonical owned data stays copyable without prices or savings', () => {
  const source = basket()
  const before = structuredClone(source)
  const copied = buildShoppingListCopyText(source, [source.lines[0].id])
  assert.equal(typeof copied, 'string')
  assert.match(copied, /Boodschappenlijst/)
  assert.match(copied, /\[x\]/)
  assert.doesNotMatch(copied,
    /pricePerPackCents|lineTotalCents|savingsCents|publicSavingsClaimEligible/)
  assert.deepEqual(source, before)
})

test('copy identity: inherited row id must not be a portable checkmark identity', () => {
  const source = basket()
  const row = matched(source)
  inherited(row, 'id', row.id)
  assert.equal(buildShoppingListCopyText(source), null)
})

test('copy identity: accessor-backed row id must not run even if returning the right string', () => {
  const source = basket()
  const row = matched(source)
  const calls = accessor(row, 'id', row.id)
  assert.equal(buildShoppingListCopyText(source), null)
  assert.equal(calls(), 0)
})

test('copy store: inherited store name must never become the portable header', () => {
  const source = basket()
  inherited(source.store, 'name', source.store.name)
  assert.equal(buildShoppingListCopyText(source), null)
})

test('copy store: accessor display name must never be executed or exported', () => {
  const source = basket()
  const calls = accessor(source.store, 'name', 'PRIVATE-SYNTHETIC-SHOP')
  assert.equal(buildShoppingListCopyText(source), null)
  assert.equal(calls(), 0)
})

test('copy product: inherited productName cannot authorize an apparent matched purchase', () => {
  const source = basket()
  const row = matched(source)
  inherited(row, 'productName', row.productName)
  assert.equal(buildShoppingListCopyText(source), null)
})

test('copy quantity: getter-backed pack count cannot authorize an apparent matched purchase', () => {
  const source = basket()
  const row = matched(source)
  const calls = accessor(row.pack, 'count', row.pack.count)
  assert.equal(buildShoppingListCopyText(source), null)
  assert.equal(calls(), 0)
})

test('copy classification: getter-backed matched status cannot select a physical instruction', () => {
  const source = basket()
  const row = matched(source)
  const calls = accessor(row, 'status', row.status)
  assert.equal(buildShoppingListCopyText(source), null)
  assert.equal(calls(), 0)
})

test('copy completed state: accessor list index cannot silently check an item', () => {
  const source = basket()
  const done = [source.lines[0].id]
  const calls = accessor(done, '0', source.lines[0].id)
  assert.equal(buildShoppingListCopyText(source, done), null)
  assert.equal(calls(), 0)
})

test('copy completed state: inherited sparse done-line index cannot check an item', () => {
  const source = basket()
  const done = new Array(1)
  const parent = Object.create(Array.prototype)
  Object.defineProperty(parent, '0', {
    value: source.lines[0].id, configurable: true,
  })
  Object.setPrototypeOf(done, parent)
  assert.equal(buildShoppingListCopyText(source, done), null)
})
