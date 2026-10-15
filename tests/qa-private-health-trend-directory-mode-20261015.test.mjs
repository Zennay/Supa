import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { evaluatePrivateAdapterHealth } from '../scripts/retailer-private-adapter-health.mjs'
import { loadReviewedRepositoryFixtures } from '../scripts/retailer-reviewed-ingest-engine.mjs'
import { main } from '../scripts/retailer-private-adapter-health-trend.mjs'

// Quality-validation only: actual archived PLUS/Deka six source kinds, 0600
// private reports, no retailer HTTP and no permission/public-savings promotion.
const cli = new URL('../scripts/retailer-private-adapter-health-trend.mjs', import.meta.url).pathname
const denied = /Private retailer health trend refused/
async function setup() {
  const batch = await loadReviewedRepositoryFixtures()
  assert.equal(batch.summary.acceptedSources, 6)
  const latest = Math.max(...batch.results.flatMap(r =>
    r.observations.map(o => Date.parse(o.provenance.capturedAt))))
  const report = evaluatePrivateAdapterHealth(batch, {
    referenceTime: new Date(latest + 3600000).toISOString(),
  })
  const root = await mkdtemp(join(tmpdir(), 'supa-qa-trend-private-root-'))
  await chmod(root, 0o700)
  const before = join(root, 'before.json')
  const after = join(root, 'after.json')
  for (const path of [before, after]) {
    await writeFile(path, JSON.stringify(report) + '\n', { mode: 0o600, flag: 'wx' })
    await chmod(path, 0o600)
  }
  return { root, before, after }
}
const cleanup = state => rm(state.root, { recursive: true, force: true })
const args = state => ['--before', state.before, '--after', state.after]
function assertPrivate(summary) {
  assert.equal(summary.mode, 'private-adapter-health-trend')
  assert.equal(summary.datasetRegressionSignalsDetected, false)
  assert.equal(summary.humanReviewRequired, true)
  assert.equal(summary.permissionVerified, false)
  assert.equal(summary.productionEnabled, false)
  assert.equal(summary.livePricesAvailable, false)
  assert.equal(summary.publicSavingsClaimEligible, false)
  assert.equal(summary.externalRequests, 0)
  assert.doesNotMatch(JSON.stringify(summary), /https?:\/\/|sourceProductId|currentPriceCents|capturedAt|sourceUrl/i)
}
async function refusalAt(mode, side) {
  const state = await setup()
  try {
    await chmod(state.root, mode)
    let writes = ''
    await assert.rejects(main(args(state), text => { writes += text }), denied,
      side + ' root cannot admit a private report from mode ' + mode.toString(8))
    assert.equal(writes, '', 'no private report or access claim may be printed')
  } finally { await cleanup(state) }
}

test('positive: owner-only 0700 evidence root and 0600 archived reports produce anonymous trend', async () => {
  const state = await setup()
  try {
    let stdout = ''
    const out = await main(args(state), text => { stdout += text })
    assertPrivate(out)
    assertPrivate(JSON.parse(stdout))
    assert.equal(stdout.endsWith('\n'), true)
  } finally { await cleanup(state) }
})

test('QA: world-executable 0755 private trend directory must be refused despite 0600 files', () =>
  refusalAt(0o755, 'readable'))

test('QA: group-readable 0750 private trend directory must be refused despite 0600 files', () =>
  refusalAt(0o750, 'group-readable'))

test('QA: group-writable 0730 private trend directory must be refused despite 0600 files', () =>
  refusalAt(0o730, 'group-writable'))

test('QA: publicly writable/traversable 0777 private trend directory must be refused', () =>
  refusalAt(0o777, 'public-writable'))

test('QA: actual operator CLI must not print a trend under a 0755 private report directory', async () => {
  const state = await setup()
  try {
    await chmod(state.root, 0o755)
    const result = spawnSync(process.execPath,
      ['--experimental-strip-types', cli, ...args(state)],
      { encoding: 'utf8', timeout: 45000, maxBuffer: 256 * 1024 })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /^Private retailer health trend refused\s*$/)
    assert.doesNotMatch(result.stderr, /https?:\/\/|sourceProductId|\.json|capturedAt|sha256/i)
  } finally { await cleanup(state) }
})
