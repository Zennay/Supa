import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Independent QA: no external retailer HTTP or publication. Isolate child OS
// temp directory so SQLite/WAL/sidecar cleanup can be checked safely.
const cli = new URL('../scripts/qa-retailer-offline-quality-bundle.mjs', import.meta.url).pathname
const historical = '2026-10-15T00:00:00Z'
const run = (args, env) => spawnSync(process.execPath,
  ['--experimental-strip-types', cli, ...args],
  { encoding: 'utf8', timeout: 90000, maxBuffer: 1024 * 1024, env })
function privateAggregate(data) {
  assert.equal(data.mode, 'historical-offline-retailer-quality-bundle')
  assert.equal(data.sourceFactParityVerified, true)
  assert.equal(data.sourceKinds, 6)
  assert.equal(data.historicalOnly, true)
  assert.equal(data.externalRequests, 0)
  assert.equal(data.trustedCurrentPrices, false)
  assert.equal(data.productionEnabled, false)
  assert.equal(data.publicSavingsClaimEligible, false)
  assert.deepEqual(Object.keys(data.storeQuality).sort(), ['dekamarkt', 'plus'])
}
function noRawEvidence(output) {
  assert.doesNotMatch(output, /https?:\/\/|currentPriceCents|offerPriceCents|sourceProductId|sourceUrl|\.db\b|FAKE_CREDENTIAL/i)
}
async function isolated(childRun) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-qa-isolated-os-tmp-'))
  try {
    const env = { ...process.env, TMPDIR: dir, TMP: dir, TEMP: dir }
    await childRun(dir, env)
    assert.deepEqual(await readdir(dir), [], 'no SQLite, WAL, sidecar or data in isolated child TMPDIR')
  } finally { await rm(dir, { recursive: true, force: true }) }
}
test('one-command six-adapter success cleans all private SQLite artifacts from isolated OS TMPDIR', async () => {
  await isolated(async (_dir, env) => {
    const out = run(['--as-of', historical], env)
    assert.equal(out.error, undefined)
    assert.equal(out.status, 0, out.stderr)
    assert.equal(out.signal, null)
    assert.equal(out.stderr, '')
    privateAggregate(JSON.parse(out.stdout))
    noRawEvidence(out.stdout)
  })
})
test('a missing Python dependency refuses operation safely and leaves no reviewed evidence behind', async () => {
  await isolated(async (dir, env) => {
    // node entrypoint is absolute, but child python3 cannot be found.
    const out = run(['--as-of', historical], { ...env, PATH: dir })
    assert.equal(out.error, undefined)
    assert.equal(out.status, 2)
    assert.equal(out.stdout, '')
    assert.match(out.stderr, /^Offline retailer quality bundle refused; no data or prices published\s*$/)
    noRawEvidence(out.stderr)
  })
})
test('two consecutive real CLI runs on separate private workspaces yield identical aggregate reports', async () => {
  const results = []
  for (let repeat = 0; repeat < 2; repeat++) {
    await isolated(async (_dir, env) => {
      const output = run(['--as-of', historical], env)
      assert.equal(output.error, undefined)
      assert.equal(output.status, 0, output.stderr)
      const report = JSON.parse(output.stdout)
      privateAggregate(report)
      noRawEvidence(output.stdout)
      results.push(report)
    })
  }
  assert.deepEqual(results[0], results[1])
})
