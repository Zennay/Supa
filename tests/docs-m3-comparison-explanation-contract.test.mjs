import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const contractPath = 'docs/M3_BASKET_COMPARISON.md'

test('M3 comparison explanation contract preserves the evidence boundary', async () => {
  const contract = await readFile(contractPath, 'utf8')
  const normalized = contract.toLowerCase()

  for (const requiredText of [
    'line delta proves only **where**',
    'does **not** by itself prove **why**',
    'pack-size, offer, planning, unit-price or reuse effect',
    'separate savings-attribution contract',
    'suppress both the overall',
    'line-level financial breakdown',
  ]) {
    assert.equal(
      normalized.includes(requiredText.toLowerCase()),
      true,
      `missing canonical M3 comparison-explanation text: ${requiredText}`,
    )
  }
})

test('M3 comparison contract keeps worse and unknown as valid outcomes', async () => {
  const contract = await readFile(contractPath, 'utf8')
  const normalized = contract.toLowerCase()

  for (const requiredOutcome of ['`better`', '`same`', '`worse`', '`unknown`']) {
    assert.equal(
      normalized.includes(requiredOutcome),
      true,
      `missing M3 comparison outcome: ${requiredOutcome}`,
    )
  }

  assert.equal(
    normalized.includes('do not use a partial\nline breakdown to imply a savings result'),
    true,
    'partial comparisons must not imply a savings claim',
  )
})
