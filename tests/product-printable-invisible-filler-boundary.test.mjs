import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'

// Unicode letters/symbols that look blank must not authenticate an item.
const invisibleFillers = ['\u115f', '\u1160', '\u3164', '\uffa0', '\u2800']
function fixture() {
  return structuredClone(buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  }))
}
function matchedLine(value) {
  const line = value.lines.find(x => x.status === 'matched')
  assert.ok(line)
  return line
}

test('blank-looking Unicode product names never print as reliable chosen products', () => {
  for (const filler of invisibleFillers) {
    const value = fixture()
    matchedLine(value).productName = filler + '\u0301'
    const before = structuredClone(value)
    const printed = preparePrintableShoppingChecklist(value)
    const item = printed.lines.find(x => x.id === matchedLine(value).id)
    assert.equal(item.needsReview, true, JSON.stringify(filler))
    assert.equal(item.label, matchedLine(value).ingredientLabel)
    assert.match(item.quantity, /handmatig kiezen/)
    assert.deepEqual(value, before)
  }
})

test('blank-looking store and unresolved ingredient names use honest fallbacks', () => {
  for (const filler of invisibleFillers) {
    const value = fixture()
    value.store.name = filler
    const line = matchedLine(value)
    line.status = 'unresolved'
    line.ingredientLabel = filler
    const printed = preparePrintableShoppingChecklist(value)
    assert.equal(printed.storeLabel, 'Winkel nog te kiezen', JSON.stringify(filler))
    const item = printed.lines.find(x => x.id === line.id)
    assert.equal(item.label, 'Onbekend ingrediënt')
    assert.equal(item.needsReview, true)
    assert.match(item.quantity, /handmatig kiezen/)
  }
})

test('invisible task identity suffixes/prefixes cannot produce apparently separate paper rows', () => {
  for (const filler of invisibleFillers) {
    for (const id of [filler, 'rice-' + filler, filler + 'rice']) {
      const value = fixture()
      matchedLine(value).id = id
      assert.throws(
        () => preparePrintableShoppingChecklist(value),
        /Dubbele of ongeldige boodschappenregel/,
        JSON.stringify(id),
      )
    }
  }
  for (const id of ['rice\u200b', 'rice\u202e', 'rice\nmore', 'rice\u2028more', ' rice ']) {
    const value = fixture()
    matchedLine(value).id = id
    assert.throws(() => preparePrintableShoppingChecklist(value), /Dubbele of ongeldige/)
  }
})

test('legitimate Unicode accents and emoji remain printable, without hidden glyphs', () => {
  const value = fixture()
  value.store.name = 'Café ' + invisibleFillers.join('') + ' Buurt'
  const product = matchedLine(value)
  product.productName = 'Crème ' + invisibleFillers.join('') + ' 🥣'
  const printed = preparePrintableShoppingChecklist(value)
  assert.equal(printed.storeLabel, 'Café Buurt')
  const selected = printed.lines.find(x => x.id === product.id)
  assert.equal(selected.label, 'Crème 🥣')
  assert.equal(selected.needsReview, false)
  assert.doesNotMatch(JSON.stringify(printed), /[\u115f\u1160\u3164\uffa0\u2800]/u)
})
