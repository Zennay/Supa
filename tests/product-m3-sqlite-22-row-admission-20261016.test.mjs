import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildReviewedRetailerSqlite, main } from
  '../scripts/retailer-build-reviewed-universal-sqlite.mjs'

const refused = /Historical reviewed retailer import refused/
async function sandbox(action) {
  const dir = await mkdtemp(join(tmpdir(), 'supa-m3-sqlite-plan-'))
  try { return await action(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

test('real six PLUS/Deka archives only create private SQLite after complete 11×2 planner admission', async () =>
  sandbox(async dir => {
    const destination = join(dir, 'reviewed.db')
    const beforeFetch = globalThis.fetch
    globalThis.fetch = () => { throw Error('RETAILER NETWORK MUST NOT RUN') }
    try {
      const result = await buildReviewedRetailerSqlite(destination)
      assert.equal(result.sources, 6)
      assert.equal(result.snapshots, 6)
      assert.equal(result.canonicalPlannerNeeds, 11)
      assert.equal(result.twoStoreReviewRows, 22)
      assert.equal(result.fullBasketFieldComparisonVerified, false)
      assert.equal(result.productionEnabled, false)
      assert.equal(result.publicSavingsClaimEligible, false)
      assert.equal(result.externalNetworkUsed, false)
      assert.ok((await readFile(destination)).byteLength > 4096)
      assert.equal((await stat(destination)).mode & 0o777, 0o600)
      await assert.rejects(buildReviewedRetailerSqlite(destination), refused)
    } finally { globalThis.fetch = beforeFetch }
  }))

test('exported SQLite CLI rejects caller argv getters, revoked proxies and fake empty arrays before IO', async () =>
  sandbox(async dir => {
    const outfile = join(dir, 'never-created.db')
    let reads = 0
    const trip = () => { reads++; throw Error('SYNTHETIC UNTRUSTED ARGV TRAP') }
    const caller = new Proxy(['--out', outfile], { get: trip, ownKeys: trip })
    await assert.rejects(main(caller), refused)
    const revoked = Proxy.revocable(['--out', outfile], {})
    revoked.revoke()
    await assert.rejects(main(revoked.proxy), err =>
      !(err instanceof TypeError) && refused.test(String(err)))
    const spoofed = new Proxy(['--out', outfile], {
      get(target, key) {
        reads++
        return key === 'length' ? 0 : Reflect.get(target, key)
      },
    })
    await assert.rejects(main(spoofed), refused)
    assert.equal(reads, 0)
    await assert.rejects(stat(outfile), { code: 'ENOENT' })
  }))

test('actual zero-network process prints private full-basket gating receipt without source facts', async () =>
  sandbox(async dir => {
    const destination = join(dir, 'archived.db')
    const cmd = new URL('../scripts/retailer-build-reviewed-universal-sqlite.mjs',
      import.meta.url).pathname
    const run = spawnSync(process.execPath, [
      '--experimental-strip-types', cmd, '--out', destination,
    ], { timeout: 45_000, encoding: 'utf8', maxBuffer: 65536 })
    assert.equal(run.status, 0, run.stderr)
    const report = JSON.parse(run.stdout)
    assert.equal(report.databaseCreated, true)
    assert.equal(report.canonicalPlannerNeeds, 11)
    assert.equal(report.twoStoreReviewRows, 22)
    assert.equal(report.fullBasketFieldComparisonVerified, false)
    assert.equal(report.publicSavingsClaimEligible, false)
    assert.equal(report.externalNetworkUsed, false)
    assert.doesNotMatch(run.stdout,
      /https?:\/\/|sourceProductId|currentPriceCents|offerPriceCents|snapshotSha256|customer/i)
    assert.equal((await stat(destination)).mode & 0o777, 0o600)
  }))
