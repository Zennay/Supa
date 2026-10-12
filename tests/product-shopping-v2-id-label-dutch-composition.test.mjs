import assert from 'node:assert/strict'
import test from 'node:test'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'
import { serializeShoppingProgressV2, shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import { startShoppingProgressSessionV2, toggleShoppingProgressSessionV2 } from '../src/features/shopping-list/shoppingListProgressSessionV2.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'

// Independent composed acceptance: #1101 visible labels + #1805 durable IDs +
// #1809 Dutch row units. All prices, stores and products are controlled M2 data.
function basket() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    products: m2Products, activeDays: ['Di'],
  })
}

function matched(b) {
  const line = b.lines.find((value) => value.status === 'matched')
  assert.ok(line)
  return line
}

test('composition: every visible text position rejects blank glyphs without admitting localized v2 rows', () => {
  const base = basket()
  const variants = [
    ['store name', (b) => { b.store.name = '\u2800' }],
    ['ingredient name', (b) => { matched(b).ingredientLabel = '\u3164' }],
    ['product name', (b) => { matched(b).productName = '\u200b\u0301' }],
    ['unknown product name', (b) => { matched(b).productName = null }],
    ['blank physical ID', (b) => { matched(b).productId = '\u115f' }],
  ]
  for (const [name, mutate] of variants) {
    const subject = structuredClone(base)
    mutate(subject)
    const original = structuredClone(subject)
    assert.equal(shoppingListDemandIdentity(subject), null, name)
    assert.equal(serializeShoppingProgressV2(subject, [matched(subject).id]), null, name)
    assert.deepEqual(shoppingListRowsV2(subject, startShoppingProgressSessionV2(subject, null)), [], name)
    assert.deepEqual(subject, original, name + ' must not be mutated')
  }
})

test('composition: legitimate display-only renames and one-cent repricing preserve Dutch checked rows', () => {
  const subject = basket()
  const row = matched(subject)
  row.pack = { ...row.pack, amount: 1, unit: 'piece', count: 1 }
  const original = structuredClone(subject)
  const key = shoppingListDemandIdentity(subject)
  assert.equal(typeof key, 'string')
  const initial = startShoppingProgressSessionV2(subject, null)
  const completed = toggleShoppingProgressSessionV2(initial, subject, row.id)
  assert.equal(shoppingListRowsV2(subject, completed).find((r) => r.id === row.id).checked, true)

  const renamed = structuredClone(subject)
  renamed.store.name = 'Buurtwinkel'
  const update = renamed.lines.find((line) => line.id === row.id)
  assert.ok(update && update.status === 'matched')
  update.ingredientLabel = 'Rijst uit de winkel'
  update.productName = 'Product met nieuw etiket'
  update.pricePerPackCents += 1
  update.lineTotalCents += update.packs
  renamed.totalCents += update.packs
  assert.equal(shoppingListDemandIdentity(renamed), key)
  const localized = shoppingListRowsV2(renamed, completed).find((r) => r.id === row.id)
  assert.ok(localized)
  assert.equal(localized.checked, true)
  assert.match(localized.quantity, / × 1 stuk$/)
  assert.equal(localized.label, 'Product met nieuw etiket')
  assert.equal(localized.quantity.includes('€'), false)
  assert.deepEqual(subject, original)
})

test('composition: canonical foreign v2 basket still restores safely, but unknown schema bytes remain protected', () => {
  const local = basket()
  const other = basket()
  other.store.id = 'andere-buurtwinkel'
  other.store.name = 'Andere winkel'
  const foreignId = matched(other).id
  const savedForeign = serializeShoppingProgressV2(other, [foreignId])
  assert.equal(typeof savedForeign, 'string')
  const values = new Map([[shoppingListProgressV2StorageKey, savedForeign]])
  const writes = []
  const storage = {
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); values.set(key, value) },
  }
  const controller = openShoppingProgressStorageV2(local, storage)
  assert.equal(controller.storageFormatStatus(), 'ready')
  assert.deepEqual(writes, [], 'opening a foreign recognized physical task must never write')
  controller.toggle(matched(local).id)
  assert.equal(controller.persist(), true, 'deliberate current-task action may replace a known foreign task')
  assert.equal(writes.length, 1)
  const savedLocal = JSON.parse(values.get(shoppingListProgressV2StorageKey))
  assert.equal(savedLocal.demandIdentity, shoppingListDemandIdentity(local))
  assert.deepEqual(savedLocal.doneLineIds, [matched(local).id])
  assert.deepEqual(writes.map(([key]) => key), [shoppingListProgressV2StorageKey])

  const protectedRaw = '{"schemaVersion":3,"futureOnly":"must-survive"}'
  values.set(shoppingListProgressV2StorageKey, protectedRaw)
  const protectedController = openShoppingProgressStorageV2(local, storage)
  assert.equal(protectedController.storageFormatStatus(), 'unknown-record')
  protectedController.toggle(matched(local).id)
  assert.equal(protectedController.persist(), false)
  assert.equal(values.get(shoppingListProgressV2StorageKey), protectedRaw)
  assert.equal(writes.length, 1, 'future record must not be overwritten')
})
