import assert from 'node:assert/strict'
import test from 'node:test'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'

// Independent QA-only validation of the frozen original owner #2443.
// All basket/products are the existing fictional M2 fixture; no genuine
// observations or retailer access. Never use an unreviewed copied algorithm.
function basket() {
  return structuredClone(buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  }))
}
function matched(source) {
  const line = source.lines.find(x => x.status === 'matched')
  assert.ok(line, 'canonical M2 basket contains matched fictional line')
  return line
}
const FILLERS = ['\u115F', '\u1160', '\u3164', '\uFFA0', '\u2800']
const INVISIBLE_CONTROL = ['\u200b', '\u202e', '\u2028', '\u2029', '\n', '\r']
const ID = 'qa-physical-line'

test('QA independent: all 5 Unicode blank families maintain matched physical truth across position variants', () => {
  let exercised = 0
  for (const filler of FILLERS) {
    for (const [input, expected] of [
      [filler + 'Rijst', 'Rijst'],
      ['Rijst' + filler, 'Rijst'],
      ['Rijst' + filler + ' en' + filler + ' bonen', 'Rijst en bonen'],
      ['crème' + filler + ' brûlée ✨', 'crème brûlée ✨'],
    ]) {
      const source = basket()
      matched(source).productName = input
      source.store.name = 'PLUS' + filler + 'Lokaal'
      const frozen = structuredClone(source)
      const printed = preparePrintableShoppingChecklist(source)
      const item = printed.lines.find(x => x.id === matched(source).id)
      assert.equal(item.label, expected, JSON.stringify([filler, input]))
      assert.equal(item.needsReview, false)
      assert.equal(printed.storeLabel, 'PLUS Lokaal')
      assert.equal(item.quantity,
        preparePrintableShoppingChecklist(basket()).lines.find(x => x.id === item.id).quantity,
        'cleaning presentation cannot alter physical purchase instructions')
      assert.equal(JSON.stringify(printed).includes(filler), false)
      assert.deepEqual(source, frozen, 'presentation must not mutate stored basket')
      exercised++
    }
  }
  assert.equal(exercised, 20)
})

test('QA independent: combined blank-only names always require human choice while other lines survive', () => {
  for (const prefix of FILLERS) for (const suffix of FILLERS) {
    const source = basket()
    const line = matched(source)
    line.productName = prefix + ' ' + suffix
    source.store.name = prefix + suffix
    const id = line.id
    const frozen = structuredClone(source)
    const printed = preparePrintableShoppingChecklist(source)
    const item = printed.lines.find(x => x.id === id)
    assert.equal(printed.storeLabel, 'Winkel nog te kiezen')
    assert.equal(item.needsReview, true, 'visually blank matched label never promotes purchase')
    assert.equal(item.label, line.ingredientLabel)
    assert.match(item.quantity, /handmatig kiezen/)
    assert.equal(printed.reviewCount, printed.lines.filter(x => x.needsReview).length)
    assert.deepEqual(source, frozen)
  }
})

test('QA independent: 5 blank and 6 control character families reject invisible / padded physical IDs', () => {
  let cases = 0
  for (const marker of [...FILLERS, ...INVISIBLE_CONTROL, '\t', '\u0000']) {
    for (const id of [marker + ID, ID + marker, 'part' + marker + '-two']) {
      const source = basket()
      matched(source).id = id
      assert.throws(
        () => preparePrintableShoppingChecklist(source),
        /Dubbele of ongeldige boodschappenregel/,
        'unsafe physical identity must never become printable or silently normalized')
      cases++
    }
  }
  assert.equal(cases, 39)
  for (const id of [' ' + ID, ID + ' ', '\u200b', '\u2800', '\u3164']) {
    const source = basket()
    matched(source).id = id
    assert.throws(() => preparePrintableShoppingChecklist(source),
      /Dubbele of ongeldige boodschappenregel/)
  }
})

test('QA independent: unreconciled invisible ingredient labels stay manual and never invent prices', () => {
  for (const filler of FILLERS) {
    const source = basket()
    const line = matched(source)
    line.status = 'unresolved'
    line.ingredientLabel = filler + '\u200b'
    const printed = preparePrintableShoppingChecklist(source)
    const row = printed.lines.find(x => x.id === line.id)
    assert.equal(row.label, 'Onbekend ingrediënt')
    assert.equal(row.needsReview, true)
    assert.match(row.quantity, /handmatig kiezen/)
    assert.doesNotMatch(JSON.stringify(printed),
      /pricePerPackCents|lineTotalCents|savingsCents|totalCents|publicSavingsClaimEligible/)
  }
})
