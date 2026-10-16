import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

// Additive independent QA; no edits to the original 18 RED or 2 canonical
// controls. Exercises the *root/array* provenance boundary left untested by
// line-level getter coverage. Uses only frozen fictional in-repo M2 fixtures.
function basket() {
  return structuredClone(buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    products: m2Products, activeDays: m2DefaultActiveDays,
  }))
}
function inherited(object, property) {
  const value = object[property]
  delete object[property]
  Object.setPrototypeOf(object, { [property]: value })
}
function accessor(object, property) {
  const value = object[property]
  let calls = 0
  Object.defineProperty(object, property, {
    enumerable: true, configurable: true,
    get() { calls++; return value },
  })
  return () => calls
}
function assertPrintableRejected(source, name) {
  assert.throws(
    () => preparePrintableShoppingChecklist(source),
    undefined,
    name + ' must not produce a printable shopping document',
  )
}
function assertCopyRejected(source, name) {
  assert.equal(buildShoppingListCopyText(source), null,
    name + ' must not be a copyable shopping document')
}

test('root control: pristine physical rows keep print and copy truth in sync', () => {
  const source = basket()
  const original = structuredClone(source)
  const print = preparePrintableShoppingChecklist(source)
  const copy = buildShoppingListCopyText(source)
  assert.equal(print.lines.length, source.lines.length)
  assert.equal(typeof copy, 'string')
  assert.equal((copy.match(/\n\[.\] /g) ?? []).length, source.lines.length)
  assert.deepEqual(source, original)
})

test('root store: inherited store cannot authorize printed or copied retailer identity', () => {
  const source = basket()
  inherited(source, 'store')
  assertPrintableRejected(source, 'inherited root store')
  assertCopyRejected(source, 'inherited root store')
})

test('root lines: inherited rows cannot authorize a complete shopping document', () => {
  const source = basket()
  inherited(source, 'lines')
  assertPrintableRejected(source, 'inherited basket lines')
  assertCopyRejected(source, 'inherited basket lines')
})

test('root store: getter-backed store must not be invoked to build either export', () => {
  const source = basket()
  const calls = accessor(source, 'store')
  assertPrintableRejected(source, 'accessor-backed root store')
  assertCopyRejected(source, 'accessor-backed root store')
  assert.equal(calls(), 0)
})

test('root lines: getter-backed line array must not be invoked to build either export', () => {
  const source = basket()
  const calls = accessor(source, 'lines')
  assertPrintableRejected(source, 'accessor-backed root rows')
  assertCopyRejected(source, 'accessor-backed root rows')
  assert.equal(calls(), 0)
})

test('nested line: inherited requirement object cannot approve either export', () => {
  const source = basket()
  const row = source.lines.find(x => x.status === 'matched')
  assert.ok(row)
  inherited(row, 'requirement')
  const paper = preparePrintableShoppingChecklist(source)
  const current = paper.lines.find(x => x.id === row.id)
  assert.equal(current?.needsReview, true)
  assertCopyRejected(source, 'inherited requirement object')
})

test('nested line: getter-backed requirement must not be invoked in either export', () => {
  const source = basket()
  const row = source.lines.find(x => x.status === 'matched')
  assert.ok(row)
  const calls = accessor(row, 'requirement')
  const paper = preparePrintableShoppingChecklist(source)
  assert.equal(paper.lines.find(x => x.id === row.id)?.needsReview, true)
  assertCopyRejected(source, 'getter-backed requirement object')
  assert.equal(calls(), 0)
})

test('copy line array: inherited missing numeric index cannot fake a complete checklist', () => {
  const source = basket()
  const first = source.lines[0]
  delete source.lines[0]
  const parent = Object.create(Array.prototype)
  Object.defineProperty(parent, '0', { value: first, configurable: true })
  Object.setPrototypeOf(source.lines, parent)
  assertCopyRejected(source, 'inherited basket array index')
  // Existing paper sparse-row protection must remain effective.
  assertPrintableRejected(source, 'inherited basket array index')
})

test('copy line array: getter-backed numeric index cannot run even if preserving contents', () => {
  const source = basket()
  const calls = accessor(source.lines, '0')
  assertCopyRejected(source, 'getter-backed basket index')
  assert.equal(calls(), 0)
})

test('copy iteration: custom iterator getter cannot authorize an export or run', () => {
  const source = basket()
  let calls = 0
  Object.defineProperty(source.lines, Symbol.iterator, {
    configurable: true,
    get() { calls++; return Array.prototype[Symbol.iterator] },
  })
  assertCopyRejected(source, 'accessor-backed iterator')
  assert.equal(calls, 0)
})

test('copy counts: inherited matched-line count may not validate a forged subset', () => {
  const source = basket()
  inherited(source, 'matchedLineCount')
  assertCopyRejected(source, 'inherited basket matched count')
})

test('copy counts: getter-backed unresolved count may not validate a forged subset', () => {
  const source = basket()
  const calls = accessor(source, 'unresolvedLineCount')
  assertCopyRejected(source, 'getter-backed basket unresolved count')
  assert.equal(calls(), 0)
})
