import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  statPillAccessibleLabel,
  statPillPresentation,
} from '../src/components/statPillPresentation.ts'

test('stat pill accessible labels combine the visible label and value once', () => {
  assert.equal(
    statPillAccessibleLabel('Gematcht', '11'),
    'Gematcht: 11',
  )
  assert.equal(
    statPillAccessibleLabel('  Controle  ', '  2  '),
    'Controle: 2',
  )
})

test('stat pill accessible labels fail safe when text is empty or visually invisible', () => {
  assert.equal(
    statPillAccessibleLabel('', ''),
    'Statistiek: Niet beschikbaar',
  )
  assert.equal(
    statPillAccessibleLabel('   ', '  € 30,08  '),
    'Statistiek: € 30,08',
  )
  assert.equal(
    statPillAccessibleLabel('\u200B\u2060', '\uFEFF\u200D'),
    'Statistiek: Niet beschikbaar',
  )
  assert.equal(
    statPillAccessibleLabel('\u061C\u00AD', '\u180E\u061C'),
    'Statistiek: Niet beschikbaar',
  )
})

test('stat pill strips invisible formatting controls without changing visible text', () => {
  assert.deepEqual(
    statPillPresentation('\u061C\u200EGematcht\u200F\u00AD', '\u180E\u206611\u2069'),
    {
      label: 'Gematcht',
      value: '11',
      accessibleLabel: 'Gematcht: 11',
    },
  )
})

test('stat pill presentation keeps visible and accessible fallbacks aligned', () => {
  assert.deepEqual(
    statPillPresentation('  Controle  ', '  2  '),
    {
      label: 'Controle',
      value: '2',
      accessibleLabel: 'Controle: 2',
    },
  )

  assert.deepEqual(
    statPillPresentation('', ''),
    {
      label: 'Statistiek',
      value: 'Niet beschikbaar',
      accessibleLabel: 'Statistiek: Niet beschikbaar',
    },
  )

  assert.deepEqual(
    statPillPresentation(null, undefined),
    {
      label: 'Statistiek',
      value: 'Niet beschikbaar',
      accessibleLabel: 'Statistiek: Niet beschikbaar',
    },
  )
})

test('StatPill exposes one named group and renders the same safe presentation visually', async () => {
  const source = await readFile(
    new URL('../src/components/StatPill.tsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /role="group"/)
  assert.match(source, /const presentation = statPillPresentation\(label, value\)/)
  assert.match(source, /aria-label=\{presentation\.accessibleLabel\}/)
  assert.match(source, /data-stat-label=\{presentation\.label\}/)
  assert.match(source, />\{presentation\.label\}<\/span>/)
  assert.match(source, />\{presentation\.value\}<\/strong>/)
  assert.equal((source.match(/aria-hidden="true"/g) || []).length, 2)
})
