import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const contractPath = 'docs/M3_OBSERVED_BASKET_STUDY.md'

test('M3 field contract keeps the canonical evidence-collection boundary explicit', async () => {
  const contract = await readFile(contractPath, 'utf8')

  for (const requiredText of [
    'current `main` revision',
    '**baseline = PLUS**',
    '**candidate = DekaMarkt**',
    'do not swap the retailers',
    'within the 24-hour study window',
    '`collection-template-not-evidence`',
    'rejects blank or option-like `--output` values before any filesystem write',
  ]) {
    assert.equal(
      contract.toLowerCase().includes(requiredText.toLowerCase()),
      true,
      `missing canonical M3 field-contract text: ${requiredText}`,
    )
  }
})
