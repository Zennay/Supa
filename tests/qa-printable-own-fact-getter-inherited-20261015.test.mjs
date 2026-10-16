import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'

// Independent quality acceptance on current main; fictional M2 data only.
// Paper lists must not derive purchase instructions from inherited data or
// invoke accessors attached to a persisted/runtime basket snapshot.
function basket() {
  return structuredClone(buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    products: m2Products, activeDays: m2DefaultActiveDays,
  }))
}
function matched(source) {
  const row = source.lines.find(line => line.status === 'matched')
  assert.ok(row, 'the frozen fixture must contain a matched line')
  return row
}
function accessor(object, field, value) {
  let calls = 0
  Object.defineProperty(object, field, {
    enumerable: true,
    configurable: true,
    get() { calls++; return value },
  })
  return () => calls
}
function inherited(object, field, value) {
  delete object[field]
  Object.setPrototypeOf(object, { [field]: value })
}
function requireManual(result, id) {
  const row = result.lines.find(line => line.id === id)
  assert.ok(row)
  assert.equal(row.needsReview, true, 'untrusted matched row must not print purchase quantity')
  assert.match(row.quantity, /handmatig kiezen/)
}

test('paper control: canonical own-data fixture still prints complete price-free manual review', () => {
  const source = basket()
  const snapshot = structuredClone(source)
  const result = preparePrintableShoppingChecklist(source)
  assert.equal(result.lines.length, source.lines.length)
  assert.equal(result.reviewCount, result.lines.filter(row => row.needsReview).length)
  assert.equal(result.isDemo, true)
  assert.deepEqual(source, snapshot)
  assert.doesNotMatch(JSON.stringify(result),
    /pricePerPackCents|lineTotalCents|savingsCents|publicSavingsClaimEligible|observedAt/)
})

test('paper identity: inherited basket row id may not be treated as an observed row identity', () => {
  const source = basket()
  const row = matched(source)
  inherited(row, 'id', row.id)
  assert.throws(
    () => preparePrintableShoppingChecklist(source),
    /Ongeldige|ongeldige|Onvolledige|onvolledige/,
  )
})

test('paper identity: accessor row id may not execute even when returning the original id', () => {
  const source = basket()
  const row = matched(source)
  const calls = accessor(row, 'id', row.id)
  assert.throws(() => preparePrintableShoppingChecklist(source))
  assert.equal(calls(), 0, 'private/synthetic getter execution is never required')
})

test('paper store trust: inherited demo store id cannot turn the document into a demo-labelled printout', () => {
  const source = basket()
  const id = source.store.id
  inherited(source.store, 'id', id)
  assert.equal(preparePrintableShoppingChecklist(source).isDemo, false)
})

test('paper store trust: accessor display name must not be read or appear on the paper', () => {
  const source = basket()
  const calls = accessor(source.store, 'name', 'PRIVATE-SYNTHETIC-STORE')
  const result = preparePrintableShoppingChecklist(source)
  assert.equal(calls(), 0)
  assert.equal(result.storeLabel, 'Winkel nog te kiezen')
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE-SYNTHETIC-STORE/)
})

test('paper line trust: inherited matched product label requires manual choice', () => {
  const source = basket()
  const row = matched(source)
  const id = row.id
  inherited(row, 'productName', row.productName)
  requireManual(preparePrintableShoppingChecklist(source), id)
})

test('paper line trust: accessor physical pack count cannot approve a purchase instruction', () => {
  const source = basket()
  const row = matched(source)
  const id = row.id
  const calls = accessor(row, 'packs', row.packs)
  requireManual(preparePrintableShoppingChecklist(source), id)
  assert.equal(calls(), 0)
})

test('paper nested trust: inherited requirement amount cannot approve a purchase instruction', () => {
  const source = basket()
  const row = matched(source)
  const id = row.id
  inherited(row.requirement, 'amount', row.requirement.amount)
  requireManual(preparePrintableShoppingChecklist(source), id)
})

test('paper nested trust: accessor multipack count cannot approve a purchase instruction', () => {
  const source = basket()
  const row = matched(source)
  const id = row.id
  const calls = accessor(row.pack, 'count', row.pack.count)
  requireManual(preparePrintableShoppingChecklist(source), id)
  assert.equal(calls(), 0)
})

test('paper array trust: accessor-backed row slot cannot be invoked to smuggle a valid row', () => {
  const source = basket()
  const row = source.lines[0]
  const calls = accessor(source.lines, '0', row)
  assert.throws(() => preparePrintableShoppingChecklist(source))
  assert.equal(calls(), 0)
})
