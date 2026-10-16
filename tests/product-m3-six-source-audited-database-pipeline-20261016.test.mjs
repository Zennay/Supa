import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { main, buildAndAuditHistoricalRetailerDatabase } from '../scripts/retailer-private-six-source-integrated-audit.mjs'

const script = fileURLToPath(new URL('../scripts/retailer-private-six-source-integrated-audit.mjs', import.meta.url))
const audit = fileURLToPath(new URL('../scripts/retailer-audit-private-sqlite.py', import.meta.url))
const refusal = /Private SUPA M3 historical pipeline refused; no prices or savings published/

function run(argv) {
  return spawnSync(process.execPath,
    ['--experimental-strip-types', script, ...argv], {
      timeout: 45_000, encoding: 'utf8', maxBuffer: 64 * 1024,
    })
}
async function privateWorkspace(verify) {
  const folder = await mkdtemp(join(tmpdir(), 'supa-private-m3-integrated-'))
  try { await verify(folder, join(folder, 'history.sqlite')) }
  finally { await rm(folder, { recursive: true, force: true }) }
}

test('six authentic offline sources -> real private SQL -> independent read-only integrity -> 11×2 HOLD', async () => {
  await privateWorkspace(async (folder, db) => {
    const result = run(['--out', db])
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stderr, '')
    assert.equal(result.stdout.trim().split('\n').length, 1)
    const report = JSON.parse(result.stdout)
    assert.equal(report.mode, 'historical-six-source-integrated-private-audit')
    assert.equal(report.reviewedSourceKinds, 6)
    assert.equal(report.canonicalPlannerNeeds, 11)
    assert.equal(report.twoStoreReviewRows, 22)
    assert.ok(report.historicalObservations >= 6)
    assert.ok(report.historicalProducts >= 1)
    assert.equal(report.physicalDatabaseIntegrityVerified, true)
    assert.equal(report.externalRequests, 0)
    assert.equal(report.releaseDecision, 'hold')
    for (const key of ['actualRetailerPricesVerified', 'fullBasketFieldComparisonVerified',
      'sourceRightsVerified', 'productionEnabled', 'publicSavingsClaimEligible']) {
      assert.equal(report[key], false)
    }
    assert.doesNotMatch(result.stdout, /(?:https?:\/\/|sourceProductId|priceCents|access_token|history\.sqlite|participantKey|offerPriceCents)/i)
    const original = await readFile(db)
    assert.equal((await stat(db)).mode & 0o777, 0o600)
    const contents = await readdir(folder)
    const independent = spawnSync('python3', [audit, '--db', db],
      { encoding: 'utf8', timeout: 30_000 })
    assert.equal(independent.status, 0, independent.stderr)
    assert.equal(JSON.parse(independent.stdout).historicalObservations, report.historicalObservations)
    assert.equal(JSON.parse(independent.stdout).products, report.historicalProducts)
    assert.deepEqual(await readFile(db), original, 'audit may not mutate DB bytes')
    assert.deepEqual(await readdir(folder), contents, 'audit may not leave WAL/journal files')
  })
})

test('integrated pipeline never overwrites an existing evidence database or leaks its name', async () => {
  await privateWorkspace(async (_, db) => {
    const original = Buffer.from('preserve historical private source bytes')
    await writeFile(db, original, { mode: 0o600, flag: 'wx' })
    const result = run(['--out', db])
    assert.equal(result.status, 2)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, refusal)
    assert.doesNotMatch(result.stderr, /history\.sqlite|supa-private-m3-integrated|preserve/i)
    assert.deepEqual(await readFile(db), original)
  })
})

test('integrated CLI rejects malformed flags and paths with zero publication', async () => {
  await privateWorkspace(async (folder, db) => {
    for (const args of [[], ['--out'], ['--out', db, '--live'],
      ['--enable-network'], ['--out', db.replace('.sqlite', '\n.sqlite')]]) {
      const result = run(args)
      assert.equal(result.status, 2, result.stderr)
      assert.equal(result.stdout, '')
      assert.match(result.stderr, refusal)
      assert.doesNotMatch(result.stderr, /supa-private-m3-integrated|history\.sqlite|TypeError|ERR_INVALID/i)
    }
    assert.deepEqual(await readdir(folder), [])
  })
})

test('direct exported API rejects hostile Proxy arguments without executing traps or producing output', async () => {
  let traps = 0
  let stdout = ''
  const hostile = new Proxy([], { get() { traps++; throw new Error('PRIVATE_TRAP_FIRED') } })
  await assert.rejects(main(hostile, value => { stdout += value }), refusal)
  assert.equal(traps, 0)
  assert.equal(stdout, '')
  await assert.rejects(buildAndAuditHistoricalRetailerDatabase('bad\0name.sqlite'), refusal)
})
