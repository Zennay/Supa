import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readme = await readFile('README.md', 'utf8')

test('README structure map matches the current executable source layout', () => {
  assert.doesNotMatch(readme, /^\s*app\/\s+app shell \/ navigation$/m)
  assert.doesNotMatch(readme, /Astra\/Work/)

  for (const expected of [
    'App.tsx         app shell / bottom navigation',
    'components/     reusable UI primitives',
    'data/           repository boundary, fixtures and retailer adapters',
    'domain/         core product types and pure logic',
    '    planner/',
    '    basket/',
    '    observation/',
    '    shopping-list/',
    '  lib/            shared presentation helpers',
    'tests/            executable regression and proof contracts',
    'scripts/          M1/M3/M4 evidence and validation tooling',
    'docs/             architecture, proof-gate and research notes',
    'evidence/         durable reviewed evidence only',
  ]) {
    assert.ok(readme.includes(expected), `README is missing current structure entry: ${expected}`)
  }
})
