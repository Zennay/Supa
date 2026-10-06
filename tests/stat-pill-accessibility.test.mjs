import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { statPillAccessibleLabel } from '../src/components/statPillPresentation.ts'

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

test('stat pill accessible labels fail safe when text is empty', () => {
  assert.equal(
    statPillAccessibleLabel('', ''),
    'Statistiek: Niet beschikbaar',
  )
  assert.equal(
    statPillAccessibleLabel('   ', '  € 30,08  '),
    'Statistiek: € 30,08',
  )
})

test('StatPill exposes one named group and hides duplicate visual text from assistive tech', async () => {
  const source = await readFile(
    new URL('../src/components/StatPill.tsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /role="group"/)
  assert.match(source, /aria-label=\{statPillAccessibleLabel\(label, value\)\}/)
  assert.equal((source.match(/aria-hidden="true"/g) || []).length, 2)
})
