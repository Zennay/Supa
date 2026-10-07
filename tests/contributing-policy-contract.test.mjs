import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const contributing = await readFile('CONTRIBUTING.md', 'utf8')

test('contributor guide requires the standard validation path', () => {
  for (const command of [
    'npm ci',
    'npm test',
    'npm run m1:matching-benchmark',
    'npm run m1:source-permission-gate',
    'npm run build',
  ]) {
    assert.match(contributing, new RegExp(command.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')))
  }
})

test('contributor guide preserves genuine M3 evidence boundaries', () => {
  assert.match(contributing, /Mock data, generated fixtures, templates and synthetic observations/i)
  assert.match(contributing, /issue #78/)
  assert.match(contributing, /PLUS \+ DekaMarkt/)
  assert.match(contributing, /must not be generalized into a public savings claim/i)
  assert.match(contributing, /permission\/licensing gated/i)
})

test('contributor guide routes security findings safely', () => {
  assert.match(contributing, /\[SECURITY\.md\]\(SECURITY\.md\)/)
  assert.match(contributing, /without explicit authorization/i)
  assert.match(contributing, /credentials and personal data out of public issues/i)
})
