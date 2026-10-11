import assert from 'node:assert/strict'
import test from 'node:test'
import { matchIngredient } from '../src/domain/matching.ts'

function match(query, name) {
  return matchIngredient({
    id: 'synthetic-mark-ingredient', query, amount: 250, unit: 'g',
  }, [{
    id: 'synthetic-mark-product', name, packAmount: 250,
    packUnit: 'g', packCount: 1, available: true,
  }])
}

test('postrepair: additional script vowels and marks never collapse into ASCII/spacing false matches (#1352)', async (t) => {
  const distinctPairs = [
    ['Tamil vowel aa', 'கா', 'க'],
    ['Thai vowel i', 'กิ', 'ก'],
    ['Hebrew point dagesh', 'בּ', 'ב'],
    ['Arabic fatha within token vs artificial space', 'بَسم', 'ب سم'],
    ['Latin extended combining mark U+1AB0', 'a\u1AB0b', 'a b'],
    ['Arabic kasra within token vs missing haraka', 'بِسم', 'بسم'],
  ]
  for (const [title, query, label] of distinctPairs) {
    await t.test(title, () => {
      assert.equal(match(query, label).type, 'abstain', JSON.stringify({query,label}))
    })
  }
})

test('postrepair: equivalent non-Latin graphemes still accept their true same identity (#1352)', async (t) => {
  const acceptedPairs = [
    ['Tamil', 'கா', 'கா'],
    ['Thai', 'กิ', 'กิ'],
    ['Arabic', 'بِسم', 'بِسم'],
    ['Hebrew', 'בּ', 'בּ'],
    ['Latin NFD folding', 'cafe\u0301', 'CAFÉ'],
    ['Latin extended letters case folding', 'ØSTERS', 'østers'],
    ['Devanagari canonical decomposition', '\u0958', 'क\u093c'],
  ]
  for (const [title, query, label] of acceptedPairs) {
    await t.test(title, () => assert.equal(match(query, label).type, 'match'))
  }
})

test('postrepair: isolated marks never count as a word or a priced product match (#1352)', () => {
  for (const isolated of ['\u0650', '\u09BE', '\u0E34', '\u05BC', '\u1AB0']) {
    assert.equal(match(isolated, isolated).type, 'abstain')
    assert.equal(match(isolated, 'basmati rijst').type, 'abstain')
  }
  assert.equal(match('østers', 'sters').type, 'abstain')
  assert.equal(match('basmati rijst', 'BASMATI RIJST').type, 'match')
})
