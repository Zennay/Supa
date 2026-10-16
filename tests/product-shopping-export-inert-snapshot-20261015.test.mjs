import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

const basket = () => structuredClone(buildOneStoreBasket({
  store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
  products: m2Products, activeDays: m2DefaultActiveDays,
}))

test('product snapshot: valid paper/copy outputs stay stable, private prices never leave the format', () => {
  const original = basket()
  const before = structuredClone(original)
  const paper = preparePrintableShoppingChecklist(original)
  const text = buildShoppingListCopyText(original, [original.lines[0].id])
  assert.equal(paper.lines.length, original.lines.length)
  assert.equal(paper.isDemo, true)
  assert.equal(typeof text, 'string')
  assert.match(text, /\[x\]/)
  assert.doesNotMatch(JSON.stringify(paper) + text, /pricePerPackCents|lineTotalCents|savingsCents/)
  assert.deepEqual(original, before)
})

test('product snapshot: getter on matching status never runs and cannot make a purchase instruction', () => {
  const original = basket()
  const row = original.lines.find(line => line.status === 'matched')
  assert.ok(row)
  let invoked = 0
  Object.defineProperty(row, 'status', {
    configurable: true, get() { invoked++; return 'matched' },
  })
  assert.throws(() => preparePrintableShoppingChecklist(original), /Onbekende|Ongeldige/)
  assert.equal(buildShoppingListCopyText(original), null)
  assert.equal(invoked, 0)
})

test('product snapshot: revoked and throwing root descriptors refuse both outputs without leaking secrets', () => {
  const original = basket()
  const revoked = Proxy.revocable(original, {})
  revoked.revoke()
  assert.throws(() => preparePrintableShoppingChecklist(revoked.proxy), /Ongeldige boodschappenmand/)
  assert.equal(buildShoppingListCopyText(revoked.proxy), null)

  const malicious = new Proxy(original, {
    getOwnPropertyDescriptor() {
      throw new Error('SECRET-MEASUREMENT-PARTICIPANT-MARKER')
    },
  })
  assert.throws(
    () => preparePrintableShoppingChecklist(malicious),
    error => error instanceof Error &&
      error.message === 'Ongeldige boodschappenmand' &&
      !error.message.includes('SECRET'),
  )
  assert.equal(buildShoppingListCopyText(malicious), null)
})

test('product snapshot: malformed checked-array iterator cannot run or mark shopping tasks complete', () => {
  const original = basket()
  const checked = [original.lines[0].id]
  let invoked = 0
  Object.defineProperty(checked, Symbol.iterator, {
    configurable: true,
    get() { invoked++; return Array.prototype[Symbol.iterator] },
  })
  assert.equal(buildShoppingListCopyText(original, checked), null)
  assert.equal(invoked, 0)
})

test('product snapshot: changed own product count still falls back to manual shopping, never fabricated quantities', () => {
  const original = basket()
  const row = original.lines.find(line => line.status === 'matched')
  assert.ok(row)
  row.packs = 0
  const printed = preparePrintableShoppingChecklist(original)
  const exposed = printed.lines.find(line => line.id === row.id)
  assert.ok(exposed)
  assert.equal(exposed.needsReview, true)
  assert.match(exposed.quantity, /handmatig kiezen/)
  assert.equal(buildShoppingListCopyText(original), null)
})


test('product snapshot: thrown hostile Error.message getter cannot execute while printing', () => {
  const original = basket()
  let reads = 0
  const thrown = new Error('PRIVATE-UNTRUSTED-ERROR')
  Object.defineProperty(thrown, 'message', {
    configurable: true,
    get() { reads++; throw new Error('PRIVATE-GEOGRAPHIC-STUDY-NOTE') },
  })
  const malicious = new Proxy(original, {
    getOwnPropertyDescriptor() { throw thrown },
  })
  assert.throws(
    () => preparePrintableShoppingChecklist(malicious),
    error => error instanceof Error &&
      error.message === 'Ongeldige boodschappenmand',
  )
  assert.equal(buildShoppingListCopyText(malicious), null)
  assert.equal(reads, 0, 'raw thrown error getter is never inspected')
})

test('product snapshot: incomplete sparse arrays retain their original Dutch refusal message', () => {
  const original = basket()
  delete original.lines[1]
  assert.throws(
    () => preparePrintableShoppingChecklist(original),
    /Onvolledige boodschappenmand/,
  )
  assert.equal(buildShoppingListCopyText(original), null)
})

test('product snapshot: array iterator override refuses even an otherwise valid row list', () => {
  const original = basket()
  let calls = 0
  Object.defineProperty(original.lines, Symbol.iterator, {
    configurable: true,
    get() { calls++; return Array.prototype[Symbol.iterator] },
  })
  assert.throws(() => preparePrintableShoppingChecklist(original), /Onvolledige boodschappenmand/)
  assert.equal(buildShoppingListCopyText(original), null)
  assert.equal(calls, 0)
})
