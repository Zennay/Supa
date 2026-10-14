import assert from 'node:assert/strict'
import test from 'node:test'

import { matchIngredient } from '../src/domain/matching.ts'
import { buildOneStoreBasket } from '../src/domain/basket.ts'

function decision(query, name) {
  return matchIngredient({ id: 'i', query, amount: 250, unit: 'g' }, [
    { id: 'p', name, packAmount: 250, packUnit: 'g', packCount: 1, available: true },
  ])
}

const fixtureBasket = (query, productName) => buildOneStoreBasket({
  store: { id: 'synthetic-store', name: 'Controlled fixture, no live retailer' },
  plan: [{ day: 'ma', recipeId: 'synthetic-recipe' }],
  activeDays: ['ma'],
  recipes: [{
    id: 'synthetic-recipe',
    ingredients: [{
      id: 'ingredient-1', label: 'Ingredient for manual review',
      query, amount: 250, unit: 'g',
    }],
  }],
  products: [{
    id: 'product-1', name: productName,
    storeId: 'synthetic-store', packAmount: 250, packUnit: 'g',
    packCount: 1, available: true, priceCents: 299,
  }],
})

test('postrepair: M2 basket must not turn a stripped foreign letter into a paid product', () => {
  const wrong = fixtureBasket('østers', 'sters')
  assert.equal(wrong.matchedLineCount, 0)
  assert.equal(wrong.unresolvedLineCount, 1)
  assert.equal(wrong.totalCents, 0)
  assert.equal(wrong.lines[0].status, 'unresolved')

  const good = fixtureBasket('østers', 'ØSTERS')
  assert.equal(good.matchedLineCount, 1)
  assert.equal(good.unresolvedLineCount, 0)
  assert.equal(good.totalCents, 299)
  assert.equal(good.lines[0].status, 'matched')
  assert.equal(good.lines[0].lineTotalCents, 299)
})

test('postrepair: multiple non-ASCII scripts remain distinct identities', async (t) => {
  const pairs = [
    ['Latin ae', 'æble', 'ble'],
    ['Latin thorn', 'þorskur', 'orskur'],
    ['Cyrillic p', '\u0440asta', 'asta'],
    ['Greek alpha', '\u03b1lmond', 'lmond'],
    ['non-ASCII suffix', 'broccoliñ', 'broccoli'],
    ['non-ASCII middle', 'broccøli', 'brocc li'],
    ['ligature in compound', 'Œufs frais', 'ufs frais'],
    ['Icelandic eth in compound', 'brauð hveiti', 'brau hveiti'],
  ]
  for (const [label, ingredient, product] of pairs) {
    await t.test(label, () => {
      assert.equal(decision(ingredient, product).type, 'abstain')
    })
  }
})

test('postrepair: normal accent and case folding remains an affirmative match', async (t) => {
  const same = [
    ['crème fraîche', 'CREME FRAICHE'],
    ['jalapeño', 'JALAPENO'],
    ['ÆBLE', 'æble'],
    ['þorskur', 'ÞORSKUR'],
    ['Dvořák', 'DVORAK'],
    ['İncir', 'incir'],
    ['gerookte østers', 'GEROOKTE ØSTERS'],
    ['Griekse yoghurt', 'Griekse YOGHURT'],
  ]
  for (const [ingredient, product] of same) {
    await t.test(ingredient, () => {
      assert.equal(decision(ingredient, product).type, 'match')
    })
  }
})

test('postrepair: no currency, savings or live-source claim is returned by matcher', () => {
  const d = decision('østers', 'ØSTERS')
  assert.equal(d.type, 'match')
  assert.equal('priceCents' in d, false)
  assert.equal('savingsCents' in d, false)
  assert.equal('store' in d, false)
})
