import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'

// Independent QA acceptance on the owner's frozen #3025 product-source SHA.
// Original 29 RED→GREEN regression blobs and all owner tests stay unchanged.
// All data are fixed M2 fiction, never real retailer observations or prices.
function basket() {
  return structuredClone(buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    products: m2Products, activeDays: m2DefaultActiveDays,
  }))
}

test('QA positive: deeply frozen own-data baskets retain identical paper and copy instructions', () => {
  const source = basket()
  const done = [source.lines[0].id, source.lines[2].id]
  const original = structuredClone(source)
  const baselinePaper = preparePrintableShoppingChecklist(source)
  const baselineCopy = buildShoppingListCopyText(source, done)
  assert.equal(typeof baselineCopy, 'string')

  for (const line of source.lines) {
    Object.freeze(line.requirement)
    if (line.pack) Object.freeze(line.pack)
    Object.freeze(line)
  }
  Object.freeze(source.lines)
  Object.freeze(source.store)
  Object.freeze(source)
  Object.freeze(done)

  assert.deepEqual(preparePrintableShoppingChecklist(source), baselinePaper)
  assert.equal(buildShoppingListCopyText(source, done), baselineCopy)
  assert.deepEqual(source, original)
  assert.equal(source.lines.length, baselinePaper.lines.length)
})

test('QA positive: getter-throwing Proxy GET traps are never executed on owned basket facts', () => {
  const original = basket()
  const ids = [original.lines[0].id]
  const expectedPaper = preparePrintableShoppingChecklist(original)
  const expectedCopy = buildShoppingListCopyText(original, ids)
  let getCalls = 0
  const denyGet = target => new Proxy(target, {
    get() {
      getCalls++
      throw Error('PRIVATE-SYNTHETIC-SHOPPING-PERSONAL-DATA')
    },
  })

  const rows = original.lines.map(line => {
    const owned = { ...line, requirement: denyGet({ ...line.requirement }) }
    if (line.status === 'matched') owned.pack = denyGet({ ...line.pack })
    return denyGet(owned)
  })
  const wrappedBasket = denyGet({
    ...original,
    store: denyGet({ ...original.store }),
    lines: denyGet(rows),
  })
  const wrappedChecked = denyGet([...ids])

  assert.deepEqual(preparePrintableShoppingChecklist(wrappedBasket), expectedPaper)
  assert.equal(buildShoppingListCopyText(wrappedBasket, wrappedChecked), expectedCopy)
  assert.equal(getCalls, 0, 'own-descriptor snapshot must never invoke any input get trap')
})

test('QA positive: 64 distinct own-data checkmark subsets preserve complete correct copy projection', () => {
  const source = basket()
  const original = structuredClone(source)
  const ids = source.lines.slice(0, 6).map(line => line.id)
  assert.equal(new Set(ids).size, 6)
  for (let mask = 0; mask < 64; mask++) {
    const checked = ids.filter((_, i) => mask & (1 << i))
    const text = buildShoppingListCopyText(source, checked)
    assert.equal(typeof text, 'string')
    assert.equal((text.match(/^\[x\]/gm) ?? []).length, checked.length)
    assert.equal((text.match(/^\[ \]/gm) ?? []).length, source.lines.length - checked.length)
    assert.doesNotMatch(text,
      /pricePerPackCents|lineTotalCents|savingsCents|publicSavingsClaimEligible|observedAt/)
  }
  assert.deepEqual(source, original, 'export must never persist or mutate tick state')
})

test('QA boundary: duplicate valid tick IDs deduplicate; one foreign ID refuses whole export', () => {
  const source = basket()
  const id = source.lines[0].id
  const expected = buildShoppingListCopyText(source, [id])
  assert.equal(buildShoppingListCopyText(source, [id, id, id]), expected)
  assert.equal(buildShoppingListCopyText(source, [id, 'fictional-external-line']), null)
  assert.equal(buildShoppingListCopyText(source, ['fictional-external-line', id]), null)
})

test('QA hostile nested descriptor trap never escapes to print or copy diagnostics', () => {
  const source = basket()
  const original = structuredClone(source)
  const row = source.lines.find(line => line.status === 'matched')
  assert.ok(row)
  let traps = 0
  row.requirement = new Proxy(row.requirement, {
    getOwnPropertyDescriptor() {
      traps++
      throw Error('PRIVATE-SYNTHETIC-SHOPPING-PERSONAL-DATA')
    },
  })
  assert.throws(
    () => preparePrintableShoppingChecklist(source),
    error => error instanceof Error &&
      error.message === 'Ongeldige boodschappenmand' &&
      !error.message.includes('PRIVATE'),
  )
  assert.equal(buildShoppingListCopyText(source), null)
  assert.ok(traps >= 2, 'both independent paths reach the inert snapshot boundary')
  assert.equal(original.lines.length, source.lines.length)
})
