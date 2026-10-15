import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Independent black-box subprocess acceptance for the merged P1 product bridge.
// Run only the checked-in SIX private historical M1 sources, never retailer HTTP.
const cli = new URL('../scripts/retailer-reviewed-planner-queue.mjs', import.meta.url).pathname
const node = (args = [], options = {}) => spawnSync(
  process.execPath,
  ['--experimental-strip-types', cli, ...args],
  { encoding: 'utf8', timeout: 20_000, maxBuffer: 512 * 1024, ...options },
)

test('real executable historical review emits exactly one aggregate-only 11x2 JSON record', () => {
  const result = node()
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  const lines = result.stdout.trim().split(/\r?\n/)
  assert.equal(lines.length, 1, 'no sidecar logs or source details in stdout')
  const data = JSON.parse(lines[0])
  assert.deepEqual(Object.keys(data).sort(), [
    'externalRequests', 'livePricesAvailable', 'mode', 'planningNeeds',
    'publicSavingsClaimEligible', 'retailerRows', 'sources',
    'suggestedForManualReview', 'unresolved',
  ].sort())
  assert.equal(data.mode, 'historical-catalog-human-review-only')
  assert.equal(data.planningNeeds, 11)
  assert.equal(data.retailerRows, 22)
  assert.equal(data.sources, 2)
  assert.equal(data.unresolved + data.suggestedForManualReview, 22)
  assert.equal(data.livePricesAvailable, false)
  assert.equal(data.externalRequests, 0)
  assert.equal(data.publicSavingsClaimEligible, false)
  assert.doesNotMatch(result.stdout + result.stderr, /https?:\/\/|@example|sourceProductId|capturedAt|sha256|offerPriceCents|currentPriceCents|ingredientLabel|dekamarkt\.nl|plus\.nl/i)
})

test('CLI is deterministic on identical frozen reviewed sources and never exposes historical product facts', () => {
  const first = node()
  const second = node()
  assert.equal(first.status, 0, first.stderr)
  assert.equal(second.status, 0, second.stderr)
  assert.equal(first.stdout, second.stdout)
  assert.ok(first.stdout.length < 512, 'only counts, never 6-source product content')
})

test('CLI rejects external path/URL arguments before source loading, without echoing their contents', () => {
  const token = 'FAKE_PRIVATE_TOKEN_ABC123'
  for (const argv of [
    ['--source', 'https://www.plus.nl/producten?token=' + token],
    ['--input', '../../' + token + '.json'],
    ['--output', token + '.json'],
  ]) {
    const run = node(argv)
    assert.equal(run.error, undefined)
    assert.equal(run.status, 2)
    assert.equal(run.stdout, '')
    assert.match(run.stderr, /Private historical catalog planner preview refused/)
    assert.doesNotMatch(run.stderr, new RegExp(token))
  }
})

test('from a fresh unrelated working directory, CLI produces no files or implicit source downloads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-planner-qa-cwd-'))
  try {
    const run = node([], { cwd: dir })
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(await readdir(dir), [], 'no unrequested export artifacts')
    assert.equal(JSON.parse(run.stdout).externalRequests, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
