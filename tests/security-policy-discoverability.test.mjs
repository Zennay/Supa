import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readme = await readFile('README.md', 'utf8')

test('README exposes the repository security reporting policy', () => {
  assert.match(readme, /^## Security$/m)
  assert.match(readme, /\[SECURITY\.md\]\(SECURITY\.md\)/)
  assert.match(readme, /sensitive details, credentials and personal data/i)
  assert.match(readme, /explicit authorization/i)
})
