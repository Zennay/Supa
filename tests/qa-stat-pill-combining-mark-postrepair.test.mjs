import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  statPillAccessibleLabel,
  statPillPresentation,
} from '../src/components/statPillPresentation.ts'

test('postrepair QA: standalone spacing and nonspacing marks cannot name statistics', async (t) => {
  const invisibleStrings = [
    ['nonspacing mark U+0300', '\u0300'],
    ['nonspacing mark U+0301', '\u0301'],
    ['spacing mark U+0903', '\u0903'],
    ['enclosing mark U+20DD', '\u20DD'],
    ['variation selector U+FE0E', '\uFE0E'],
    ['variation selector U+FE0F', '\uFE0F'],
    ['mark-only with directional controls', '\u061C\u0300\uFE0F\u2060'],
    ['mark-only with whitespace', ' \t\u0301\u20DD\n'],
  ]

  for (const [description, value] of invisibleStrings) {
    await t.test(description, () => {
      assert.deepEqual(statPillPresentation(value, value), {
        label: 'Statistiek',
        value: 'Niet beschikbaar',
        accessibleLabel: 'Statistiek: Niet beschikbaar',
      })
      assert.equal(statPillAccessibleLabel(value, '7'), 'Statistiek: 7')
      assert.equal(statPillAccessibleLabel('Prijs', value), 'Prijs: Niet beschikbaar')
    })
  }
})

test('postrepair QA: perceivable base characters preserve original marks and semantic text', () => {
  const tests = [
    ['\u00E9', '€ 1,00'],
    ['e\u0301', '5\u0301'],
    ['\u0301E\u0301', '\u0301e\u0301'],
    ['\u2764\uFE0F', '\u2615\uFE0F'],
    ['a\u0903', '\u20DD!'],
    ['—', '0'],
    ['\u2060Opgehaald\u061C', '\u180E 4\u200B '],
  ]
  for (const [label, value] of tests) {
    const cleanLabel = label.replace(/[\p{Cf}\u180E]/gu, '').trim()
    const cleanValue = value.replace(/[\p{Cf}\u180E]/gu, '').trim()
    assert.deepEqual(statPillPresentation(label, value), {
      label: cleanLabel,
      value: cleanValue,
      accessibleLabel: `${cleanLabel}: ${cleanValue}`,
    })
  }
})

test('postrepair QA: actual StatPill uses the same presentation for aria and visible strings', async () => {
  const source = await readFile(
    new URL('../src/components/StatPill.tsx', import.meta.url), 'utf8',
  )
  assert.match(source, /const presentation = statPillPresentation\(label, value\)/)
  assert.match(source, /aria-label=\{presentation\.accessibleLabel\}/)
  assert.match(source, /data-stat-label=\{presentation\.label\}/)
  assert.match(source, />\{presentation\.label\}<\/span>/)
  assert.match(source, />\{presentation\.value\}<\/strong>/)
})
