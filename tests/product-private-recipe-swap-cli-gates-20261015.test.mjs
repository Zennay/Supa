import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const COMMANDS = [
  ['memory', fileURLToPath(new URL('../scripts/retailer-reviewed-custom-week.mjs', import.meta.url)),
    'uniqueIngredientNeeds', 'retailerReviewRows'],
  ['private-SQLite', fileURLToPath(new URL('../scripts/retailer-private-sqlite-planner-review.mjs', import.meta.url)),
    'ingredientNeeds', 'retailerReviewRows'],
]

function cli(path, args) {
  return spawnSync(process.execPath, ['--experimental-strip-types', path, ...args], {
    encoding: 'utf8',
    timeout: 45_000,
    maxBuffer: 64 * 1024,
  })
}

for (const [kind, path, ingredientCount, retailerRows] of COMMANDS) {
  test(kind + ' real CLI shows only safe totals for two swapped pasta meals', () => {
    const result = cli(path, ['--plan', 'Ma:pasta,Do:pasta'])
    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(result.status, 0, result.stderr)
    const record = JSON.parse(result.stdout)
    assert.equal(record[ingredientCount], 3)
    assert.equal(record[retailerRows], 6)
    assert.equal(record.livePricesAvailable, false)
    assert.equal(record.publicSavingsClaimEligible, false)
    assert.equal(record.externalRequests, 0)
    assert.doesNotMatch(result.stdout, /https?:|sourceUrl|productName|productId|ingredientId|priceCents|capturedAt|participant|€|actualSavingsCents|savingsPercent|claimedSavings/i)
  })

  test(kind + ' invalid recipe cannot create any stdout or reveal source paths', () => {
    for (const unsafe of ['Ma:unknown', 'Ma:pasta,Ma:tikka', 'Ma:pasta, Do:tikka']) {
      const result = cli(path, ['--plan', unsafe])
      assert.equal(result.error, undefined, result.error?.message)
      assert.equal(result.status, 2)
      assert.equal(result.stdout, '')
      assert.doesNotMatch(result.stderr, /https?:|sourceUrl|productId|ingredientId|participant|\.db|\.json|stack| at /i)
      assert.match(result.stderr, /refused/i)
    }
  })
}
