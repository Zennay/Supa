import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { assertHistoricalOnlyRights, attestM3OfflineReadiness, main } from '../scripts/qa-m3-source-readiness-attestation-20261016.mjs'

const clock = '2026-10-15T00:00:00Z'
const script = fileURLToPath(new URL('../scripts/qa-m3-source-readiness-attestation-20261016.mjs', import.meta.url))
const sourceRegister = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const run = args => spawnSync(process.execPath, ['--experimental-strip-types', script, ...args], {
  encoding: 'utf8', timeout: 65_000, maxBuffer: 128 * 1024,
})

function assertPrivateHold(report) {
  assert.equal(report.kind, 'supa-m3-offline-evidence-and-rights-attestation')
  assert.equal(report.verdict, 'HOLD')
  assert.equal(report.archivedSixShapeParityVerified, true)
  assert.equal(report.archivedSnapshotCount, 6)
  assert.equal(report.archivedProductCount, 13)
  assert.equal(report.archivedObservationCount, 16)
  assert.deepEqual(report.canonicalPermissionPosture, [
    { retailer: 'dekamarkt', permission: 'unresolved', productionEnabled: false },
    { retailer: 'plus', permission: 'permission_required', productionEnabled: false },
  ])
  for (const retailer of ['plus', 'dekamarkt']) {
    assert.equal(report.offlineQualityByRetailer[retailer].archivedSourceKinds, 3)
    assert.equal(report.offlineQualityByRetailer[retailer].archivedSnapshots, 3)
    assert.ok(report.offlineQualityByRetailer[retailer].archivedObservations > 0)
  }
  for (const key of [
    'productionIngestionAuthorized', 'publicCurrentPriceClaimsAuthorized',
    'fieldBasketElevenByTwoVerified', 'observedSavingsClaimVerified',
    'permanentVpsRunnerVerified', 'containsProductIdentifiersOrPrices',
  ]) assert.equal(report[key], false, key + ' must stay explicitly false')
  assert.equal(report.externalRequests, 0)
  assert.doesNotMatch(JSON.stringify(report), /https?:\/\/|sourceUrl|productName|sourceProductId|participantKey|FAKE_SECRET|Kippendij|€|\.sqlite/u)
}

test('genuine current M1 source register and six historical SQLite sources yield HOLD, not live price claims', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = () => { throw Error('NO RETAILER HTTP IN QA ATTESTATION') }
  try { assertPrivateHold(await attestM3OfflineReadiness(clock)) }
  finally { globalThis.fetch = originalFetch }
})

test('real CLI emits exactly one anonymous historical-only release HOLD and no intermediate logs', () => {
  const runResult = run(['--as-of', clock])
  assert.ifError(runResult.error)
  assert.equal(runResult.status, 0, runResult.stderr)
  assert.equal(runResult.stderr, '')
  assert.equal(runResult.stdout.trim().split(/\r?\n/u).length, 1)
  assertPrivateHold(JSON.parse(runResult.stdout))
})

test('canonical rights drift can never quietly convert six offline snapshots into authorization', async () => {
  const raw = JSON.parse(await readFile(sourceRegister, 'utf8'))
  assert.equal(assertHistoricalOnlyRights(raw).length, 2)
  for (const mutate of [
    doc => { doc.sources[0].permissionStatus = 'permitted' },
    doc => { doc.sources[1].productionEnabled = true },
    doc => { doc.sources[0].evidence[0].kind = 'written_permission'; doc.sources[0].permissionStatus = 'permitted'; doc.sources[0].productionEnabled = true },
    doc => { doc.sources.splice(0, 1) },
    doc => { doc.sources.push(structuredClone(doc.sources[0])) },
    doc => { doc.version = 2 },
  ]) {
    const changed = structuredClone(raw)
    mutate(changed)
    assert.throws(() => assertHistoricalOnlyRights(changed),
      /Private SUPA M3 readiness attestation refused/u)
  }
  assert.deepEqual(assertHistoricalOnlyRights(raw).map(row => row.retailer), ['dekamarkt', 'plus'])
})

test('unexpected flags, caller-provided database/registry and forged future review clocks are refused before output', () => {
  for (const args of [
    ['--rights', 'https://example.test/FAKE_SECRET'],
    ['--database', '../../FAKE_SECRET.sqlite'],
    ['--out', 'FAKE_SECRET.json'],
    ['--as-of', '2099-01-01T00:00:00Z'],
    ['--as-of', '2026-02-31T00:00:00Z'],
    ['--as-of', '2026-10-15T00:00:00+00:00'],
    ['--as-of'],
  ]) {
    const result = run(args)
    assert.equal(result.status, 2, result.stderr)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /Private SUPA M3 readiness attestation refused/u)
    assert.doesNotMatch(result.stderr, /FAKE_SECRET|https?:\/\/|\.sqlite/u)
  }
})

test('embedded public main returns one deterministic report identical to direct API', async () => {
  const outputs = []
  const a = await main(['--as-of', clock], x => outputs.push(x))
  const b = await attestM3OfflineReadiness(clock)
  assert.deepEqual(a, b)
  assert.equal(outputs.length, 1)
  assert.deepEqual(JSON.parse(outputs[0]), b)
})
