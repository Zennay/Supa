import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { statPillPresentation } from '../src/components/statPillPresentation.ts'

test('StatPill keeps runtime-unknown props behind the presentation sanitizer', async () => {
  const source = await readFile(
    new URL('../src/components/StatPill.tsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /label:\\s*unknown/)
  assert.match(source, /value:\\s*unknown/)
  assert.match(source, /statPillPresentation\\(label, value\\)/)
})

test('malformed dynamic StatPill values resolve to the existing safe fallbacks', () => {
  assert.deepEqual(statPillPresentation(null, 42), {
    label: 'Statistiek',
    value: 'Niet beschikbaar',
    accessibleLabel: 'Statistiek: Niet beschikbaar',
  })

  assert.deepEqual(statPillPresentation('  Budget  ', undefined), {
    label: 'Budget',
    value: 'Niet beschikbaar',
    accessibleLabel: 'Budget: Niet beschikbaar',
  })
})
