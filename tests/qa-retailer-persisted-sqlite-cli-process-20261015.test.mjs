import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Independent subprocess QA of pinned product #2918. Real six bundled
// offline PLUS/Deka captures -> 0600 SQLite -> private reader -> planner.
// No retailer network requests, real prices, rights grants, or public claims.
const cli = new URL('../scripts/retailer-private-sqlite-planner-review.mjs', import.meta.url).pathname
const run = (args = [], opts = {}) => spawnSync(
  process.execPath, ['--experimental-strip-types', cli, ...args],
  { encoding: 'utf8', timeout: 45_000, maxBuffer: 512 * 1024, ...opts },
)
function safeSummary(runResult, days, needs, rows) {
  assert.equal(runResult.error, undefined)
  assert.equal(runResult.status, 0, runResult.stderr)
  const lines = runResult.stdout.trim().split(/\r?\n/)
  assert.equal(lines.length, 1, 'only one privacy-safe aggregate JSON output')
  const result = JSON.parse(lines[0])
  assert.deepEqual(Object.keys(result).sort(), [
    'mode', 'sourceSnapshots', 'persistedProducts', 'selectedMealDays',
    'ingredientNeeds', 'retailerReviewRows', 'proposedForManualReview',
    'unresolved', 'productionEnabled', 'publicSavingsClaimEligible',
    'livePricesAvailable', 'externalRequests',
  ].sort())
  assert.equal(result.mode, 'persisted-private-sqlite-to-dynamic-planner-review')
  assert.equal(result.sourceSnapshots, 6)
  assert.equal(result.persistedProducts, 13)
  assert.equal(result.selectedMealDays, days)
  assert.equal(result.ingredientNeeds, needs)
  assert.equal(result.retailerReviewRows, rows)
  assert.equal(result.proposedForManualReview + result.unresolved, rows)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(result.livePricesAvailable, false)
  assert.equal(result.externalRequests, 0)
  assert.doesNotMatch(runResult.stdout + runResult.stderr,
    /sourceUrl|capturedAt|sourceProductId|priceCents|offerPrice|snapshotSha256|https?:\/\/|plus\.nl|dekamarkt\.nl|Kippendij|participantKey|FAKE_SECRET/i)
  return result
}

test('actual persisted-source CLI: Ma,Do works end-to-end with five needs and 10 private retailer reviews', () => {
  safeSummary(run(['--days', 'Ma,Do']), 2, 5, 10)
})

test('actual persisted-source CLI: default planner is still 11 needs x 2 stores without prices', () => {
  safeSummary(run(), 4, 11, 22)
})

test('actual persisted-source CLI: valid days are order invariant after database round-trip', () => {
  const forward = safeSummary(run(['--days', 'Ma,Do']), 2, 5, 10)
  const reversed = safeSummary(run(['--days', 'Do,Ma']), 2, 5, 10)
  assert.deepEqual(reversed, forward)
})

test('actual persisted-source CLI: refuses external paths and invalid day claims with zero output', () => {
  for (const argv of [
    ['--database', 'https://www.plus.nl/?auth=FAKE_SECRET'],
    ['--out', 'FAKE_SECRET.db'],
    ['--days', 'Ma,Ma'],
    ['--days', 'Vr'],
    ['--days', '../FAKE_SECRET'],
    ['--days', 'Ma, Do'],
    ['--days'],
  ]) {
    const rejected = run(argv)
    assert.equal(rejected.error, undefined)
    assert.equal(rejected.status, 2)
    assert.equal(rejected.stdout, '')
    assert.match(rejected.stderr, /Private SQLite\/planner review refused/)
    assert.doesNotMatch(rejected.stderr, /FAKE_SECRET|https?:\/\/|\.db\b/)
  }
})

test('actual persisted-source CLI: unrelated cwd remains empty after private SQLite round-trip', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-persisted-week-'))
  try {
    safeSummary(run(['--days','Ma,Do'], { cwd: dir }), 2, 5, 10)
    assert.deepEqual(await readdir(dir), [], 'private temp database must not leak to caller cwd')
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
})
