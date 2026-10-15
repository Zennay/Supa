import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { main as review, buildOfflineQualityBundle } from '../scripts/qa-retailer-offline-quality-bundle.mjs'

// Execute real six archived retailer adapters, private SQL and both QA gates.
// No dummy price reaches a public result.
const cli = new URL('../scripts/qa-retailer-offline-quality-bundle.mjs', import.meta.url).pathname
const clock = '2026-10-15T00:00:00Z'
const run = (args = [], opts = {}) => spawnSync(process.execPath,
  ['--experimental-strip-types', cli, ...args],
  { encoding: 'utf8', timeout: 60_000, maxBuffer: 256 * 1024, ...opts })
function check(data) {
  assert.equal(data.mode, 'historical-offline-retailer-quality-bundle')
  assert.equal(data.assessmentClock, clock)
  assert.equal(data.sourceKinds, 6)
  assert.equal(data.sourceFactParityVerified, true)
  assert.equal(data.verifiedOriginalObservations, 16)
  assert.equal(data.snapshots, 6)
  assert.equal(data.products, 13)
  assert.equal(data.observations, 16)
  assert.equal(data.historicalOnly, true)
  assert.equal(data.trustedCurrentPrices, false)
  assert.equal(data.productionEnabled, false)
  assert.equal(data.publicSavingsClaimEligible, false)
  assert.equal(data.externalRequests, 0)
  assert.deepEqual(Object.keys(data.storeQuality), ['dekamarkt', 'plus'])
  for (const s of Object.values(data.storeQuality)) {
    assert.equal(s.snapshots, 3)
    assert.equal(s.staleSnapshots, 3)
    assert.equal(s.captureKinds, 3)
    assert.ok(s.observations > 0)
  }
  assert.doesNotMatch(JSON.stringify(data),
    /https?:\/\/|sourceUrl|productName|currentPriceCents|offerPriceCents|sourceProductId|participantKey|Kippendij|FAKE_SECRET/i)
}
test('one execution composes actual six-source SQLite, two independent QA checks and a private aggregate report', async () => {
  const oldFetch = globalThis.fetch
  globalThis.fetch = () => { throw new Error('NO RETAIL HTTP IN QA BUNDLE') }
  try { check(await buildOfflineQualityBundle(clock)) }
  finally { globalThis.fetch = oldFetch }
})

test('CLI prints exactly one anonymous historical-only JSON result, not intermediate price/name/URL logs', () => {
  const output = run(['--as-of', clock])
  assert.equal(output.error, undefined)
  assert.equal(output.status, 0, output.stderr)
  assert.equal(output.stdout.trim().split(/\r?\n/).length, 1)
  check(JSON.parse(output.stdout))
  assert.doesNotMatch(output.stderr, /https?:\/\/|\.db|price|token/i)
})

test('same six immutable historical inputs and review clock produce deterministic QA bundle bytes', async () => {
  const a = await buildOfflineQualityBundle(clock)
  const b = await buildOfflineQualityBundle(clock)
  assert.deepEqual(a, b)
})

test('external URL, output paths, future/invalid clocks cannot become an upload, fetch or claim', () => {
  for (const args of [
    ['--database', 'https://www.plus.nl?token=FAKE_SECRET'],
    ['--out', '../../FAKE_SECRET.db'],
    ['--as-of', '2035-01-01T00:00:00Z'],
    ['--as-of', '2026-02-31T00:00:00Z'],
    ['--as-of'], ['--as-of', '2026-10-15T00:00:00+00:00'],
  ]) {
    const output = run(args)
    assert.equal(output.error, undefined)
    assert.equal(output.status, 2)
    assert.equal(output.stdout, '')
    assert.match(output.stderr, /Offline retailer quality bundle refused/)
    assert.doesNotMatch(output.stderr, /FAKE_SECRET|https?:\/\/|\.db\b/)
  }
})

test('actual CLI keeps an unrelated current working directory empty after cleanup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-bundle-cwd-'))
  try {
    const output = run(['--as-of', clock], { cwd: dir })
    assert.equal(output.status, 0, output.stderr)
    check(JSON.parse(output.stdout))
    assert.deepEqual(await readdir(dir), [])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('embedded API invocation returns one structured report without exposing any raw source evidence', async () => {
  const writes = []
  const output = await review(['--as-of', clock], item => writes.push(item))
  assert.equal(writes.length, 1)
  assert.deepEqual(JSON.parse(writes[0]), output)
  check(output)
})
