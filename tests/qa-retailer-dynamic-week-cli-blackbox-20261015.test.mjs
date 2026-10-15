import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Independent end-to-end, black-box QA of merged P1 dynamic planner #2914.
// All inputs are six already-reviewed historical local retailer fixtures.
const script = new URL('../scripts/retailer-reviewed-custom-week.mjs', import.meta.url).pathname
const run = (args = [], other = {}) => spawnSync(
  process.execPath,
  ['--experimental-strip-types', script, ...args],
  { encoding: 'utf8', timeout: 25_000, maxBuffer: 512 * 1024, ...other },
)

function checkPrivate(result, expectedDays, expectedNeeds, expectedRows) {
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  const lines = result.stdout.trim().split(/\r?\n/)
  assert.equal(lines.length, 1, 'only aggregate JSON, not capture details')
  const parsed = JSON.parse(lines[0])
  assert.deepEqual(Object.keys(parsed).sort(), [
    'activeDays', 'externalRequests', 'livePricesAvailable', 'mode',
    'proposedForManualReview', 'publicSavingsClaimEligible',
    'retailerReviewRows', 'selectedMeals', 'uniqueIngredientNeeds', 'unresolved',
  ].sort())
  assert.equal(parsed.mode, 'dynamic-week-private-review-only')
  assert.equal(parsed.activeDays, expectedDays)
  assert.equal(parsed.selectedMeals, expectedDays)
  assert.equal(parsed.uniqueIngredientNeeds, expectedNeeds)
  assert.equal(parsed.retailerReviewRows, expectedRows)
  assert.equal(parsed.proposedForManualReview + parsed.unresolved, expectedRows)
  assert.equal(parsed.livePricesAvailable, false)
  assert.equal(parsed.publicSavingsClaimEligible, false)
  assert.equal(parsed.externalRequests, 0)
  assert.doesNotMatch(result.stdout + result.stderr, /https?:\/\/|plus\.nl|dekamarkt\.nl|capturedAt|sourceUrl|priceCents|Kippendij|ingredientId|email|FAKE_PRIVATE_TOKEN/i)
  return parsed
}

test('real CLI: Monday+Thursday combines 600g chicken / five needs into exactly ten private review rows', () => {
  const result = checkPrivate(run(['--days', 'Ma,Do']), 2, 5, 10)
  assert.equal(result.unresolved >= 0, true)
})

test('real CLI: default full selected week remains 11 distinct needs and 22 private retailer rows', () => {
  checkPrivate(run(), 4, 11, 22)
})

test('real CLI: changing selected days order does not change aggregated counts or review outcomes', () => {
  const forward = checkPrivate(run(['--days', 'Ma,Do']), 2, 5, 10)
  const reverse = checkPrivate(run(['--days', 'Do,Ma']), 2, 5, 10)
  assert.deepEqual(forward, reverse)
})

test('real CLI: rejects duplicate, unsupported, unknown or external input with zero stdout and generic errors', () => {
  const secret = 'FAKE_PRIVATE_TOKEN'
  const invalid = [
    ['--days', 'Ma,Ma'],
    ['--days', 'Vr'],
    ['--days', 'Ma, Do'],
    ['--days', ''],
    ['--days'],
    ['--input', 'https://www.plus.nl/?credential=' + secret],
    ['--output', '../../' + secret + '.json'],
    ['--days', '../' + secret],
  ]
  for (const args of invalid) {
    const response = run(args)
    assert.equal(response.error, undefined)
    assert.equal(response.status, 2, JSON.stringify(args))
    assert.equal(response.stdout, '')
    assert.match(response.stderr, /Private planned-week review refused/)
    assert.doesNotMatch(response.stderr, /FAKE_PRIVATE_TOKEN|https?:\/\/|\.json/i)
  }
})

test('real CLI: isolated working directory remains empty after a successful two-day preview', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-week-review-cli-'))
  try {
    checkPrivate(run(['--days', 'Ma,Do'], { cwd: dir }), 2, 5, 10)
    assert.deepEqual(await readdir(dir), [], 'never write private price/provenance/participant files automatically')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
