import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const contractPath = 'docs/M3_OBSERVED_BASKET_STUDY.md'

test('M3 field contract keeps the canonical evidence-collection boundary explicit', async () => {
  const contract = await readFile(contractPath, 'utf8')

  assert.match(contract, /current `main` revision/)
  assert.match(contract, /**baseline = PLUS**/)
  assert.match(contract, /**candidate = DekaMarkt**/)
  assert.match(contract, /do not swap the retailers/i)
  assert.match(contract, /within the 24-hour study window/)
  assert.match(contract, /`collection-template-not-evidence`/)
})
