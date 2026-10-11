import assert from 'node:assert/strict'
import test from 'node:test'

import { matchIngredient } from '../src/domain/matching.ts'

function decision(query, name) {
  return matchIngredient({
    id: 'synthetic-mark-requirement', query, amount: 250, unit: 'g',
  }, [{
    id: 'synthetic-mark-product', name, packAmount: 250,
    packUnit: 'g', packCount: 1, available: true,
  }])
}

test('QA: non-Latin combining marks must not manufacture word boundaries (#1352)', async (t) => {
  const pairs = [
    ['Arabic kasra within one word', 'بِسم', 'ب سم'],
    ['Bengali vowel sign aa differs from unvowelled consonant', 'কা', 'ক'],
    ['Bengali vowel sign o differs from unvowelled consonant', 'কো', 'ক'],
    ['Devanagari long-i sign differs from base consonant', 'की', 'क'],
    ['Malayalam vowel sign aa differs from base consonant', 'കാ', 'ക'],
  ]
  for (const [name, query, product] of pairs) {
    await t.test(name, () => {
      const observed = decision(query, product)
      assert.equal(observed.type, 'abstain', JSON.stringify({ query, product, observed }))
    })
  }
})

test('QA: matching words with same non-Latin marks should keep their true identity (#1352)', async (t) => {
  for (const [name, query, product] of [
    ['Arabic kasra same token', 'بِسم', 'بِسم'],
    ['Bengali same vowelled word', 'কা', 'কা'],
    ['Devanagari same vowelled word', 'की', 'की'],
    ['Malayalam same vowelled word', 'കാ', 'കാ'],
    ['Latin NFD accent folding', 'cafe\u0301', 'CAFÉ'],
    ['Distinct Scandinavian Unicode letter', 'østers', 'ØSTERS'],
  ]) {
    await t.test(name, () => {
      assert.equal(decision(query, product).type, 'match')
    })
  }
})

test('QA: isolated combining marks and unrelated words must abstain (#1352)', () => {
  for (const mark of ['\u0650', '\u09BE', '\u0940', '\u0D3E']) {
    assert.equal(decision(mark, mark).type, 'abstain')
  }
  assert.equal(decision('østers', 'sters').type, 'abstain')
  assert.equal(decision('de', 'de').type, 'abstain')
})
