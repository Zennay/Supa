import assert from 'node:assert/strict'
import test from 'node:test'

import { matchIngredient } from '../src/domain/matching.ts'

function decide(query, name, unit = 'g') {
  return matchIngredient({
    id: 'synthetic-ingredient', query, amount: 250, unit,
  }, [{
    id: 'synthetic-product', name, packAmount: 250,
    packUnit: unit, packCount: 1, available: true,
  }])
}

test('meaningful Unicode letters must not be deleted into a false ingredient match', async (t) => {
  const pairs = [
    ['o-slash meaningful letter', 'østers', 'sters'],
    ['o-e ligature', 'œuf', 'uf'],
    ['Polish l-stroke', 'Łódź', 'odz'],
    ['Cyrillic a confusable', '\u0430pple', 'pple'],
    ['Icelandic eth', 'brauð', 'brau'],
    ['multiword non-ASCII letter', 'gerookte østers', 'gerookte sters'],
  ]
  for (const [reason, requirement, product] of pairs) {
    await t.test(reason, () => {
      const observed = decide(requirement, product)
      assert.equal(observed.type, 'abstain', JSON.stringify({ requirement, product, observed }))
    })
  }
})

test('genuinely equivalent token identities keep matching normally', async (t) => {
  const pairs = [
    ['identical Scandinavian word after case folding', 'østers', 'ØSTERS'],
    ['identical French ligature with case folding', 'œuf', 'ŒUF'],
    ['identical Polish diacritic forms', 'Łódź', 'łódź'],
    ['decomposed versus precomposed accents', 'crème fraîche', 'CREME FRAICHE'],
    ['normal Dutch groceries', 'basmati rijst', 'BASMATI RIJST'],
    ['composed vs decomposed e acute', 'café', 'cafe\u0301'],
  ]
  for (const [label, requirement, product] of pairs) {
    await t.test(label, () => {
      assert.equal(decide(requirement, product).type, 'match')
    })
  }
})

test('stop-word-only and partial unrelated text never give a trusted match', () => {
  assert.equal(decide('de', 'de').type, 'abstain')
  assert.equal(decide('østers', 'gerookte kip').type, 'abstain')
})
