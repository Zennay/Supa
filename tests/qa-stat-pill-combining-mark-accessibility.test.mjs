import assert from 'node:assert/strict'
import test from 'node:test'

import {
  statPillAccessibleLabel,
  statPillPresentation,
} from '../src/components/statPillPresentation.ts'

test('qa: isolated combining marks and emoji variation selectors are not valid accessible labels', async (t) => {
  for (const [kind, invisible] of [
    ['variation selector 16', '\uFE0F'],
    ['combining accent', '\u0301'],
    ['combining grapheme joiner', '\u034F'],
    ['multi-mark with format controls', '\u200D\u0301\uFE0F\u2060'],
    ['spaced isolated marks', ' \u0300 \u0301 '],
    ['isolated variation selectors and combining marks', '\uFE0F\u0301'],
  ]) {
    await t.test(kind, () => {
      assert.equal(
        statPillAccessibleLabel(invisible, invisible),
        'Statistiek: Niet beschikbaar',
      )
      assert.deepEqual(statPillPresentation(invisible, invisible), {
        label: 'Statistiek',
        value: 'Niet beschikbaar',
        accessibleLabel: 'Statistiek: Niet beschikbaar',
      })
    })
  }
})

test('qa: malformed runtime types still use the same safe visible/accessible fallback', () => {
  const unexpected = [null, undefined, 1, true, {}, [], Symbol('combining')]
  for (const value of unexpected) {
    assert.deepEqual(statPillPresentation(value, value), {
      label: 'Statistiek',
      value: 'Niet beschikbaar',
      accessibleLabel: 'Statistiek: Niet beschikbaar',
    })
  }
})

test('qa: real text retains valid marks and emoji presentation selectors', () => {
  const cases = [
    ['Cafe\u0301', 'E\u0301en', 'Cafe\u0301: E\u0301en'],
    ['\u0301Gematcht', '5\u0301', '\u0301Gematcht: 5\u0301'],
    ['Bekijk \u2764\uFE0F', '\u2600\uFE0F', 'Bekijk \u2764\uFE0F: \u2600\uFE0F'],
    ['\u2060Werkelijk\u200B', '\u200D11\u2060', 'Werkelijk: 11'],
  ]
  for (const [label, value, accessibleLabel] of cases) {
    assert.deepEqual(statPillPresentation(label, value), {
      label: label.replace(/[\p{Cf}\u180E]/gu, '').trim(),
      value: value.replace(/[\p{Cf}\u180E]/gu, '').trim(),
      accessibleLabel,
    })
  }
})
