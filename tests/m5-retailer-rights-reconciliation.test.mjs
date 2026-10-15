import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { reconcileRetailerRights } from '../scripts/m5-reconcile-retailer-rights.mjs'

const discoveryUrl = new URL('../docs/m5-retailer-discovery.v1.json', import.meta.url)
const gateUrl = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const [discoveryText, gateText] = await Promise.all([
  readFile(discoveryUrl, 'utf8'), readFile(gateUrl, 'utf8'),
])
const registry = JSON.parse(discoveryText)
const gate = JSON.parse(gateText)
const inputs = () => [structuredClone(registry), structuredClone(gate)]

test('M5 reconciliation shows the real existing two-store rights blockers with no M5 go', () => {
  const [discovery, m1] = inputs()
  const report = reconcileRetailerRights(discovery, m1)
  assert.equal(report.m5Eligible, false)
  assert.equal(report.productionReady, false)
  assert.equal(report.m1ProductionReady, false)
  assert.equal(report.m5SourceCount, 17)
  assert.equal(report.m1ExpectedCount, 2)
  assert.equal(report.m1BlockedCount, 2)
  assert.equal(report.blockedForM5, 17)
  const actual = Object.fromEntries(report.sourceStatuses
    .filter((source) => source.historicalM1TechnicalProof)
    .map((source) => [source.supermarket, source.m1PermissionStatus]))
  assert.deepEqual(actual, { dekamarkt: 'unresolved', plus: 'permission_required' })
  assert.ok(report.sourceStatuses.every((source) =>
    !source.m5ProductionEnabled && source.m5PermissionStatus === 'unreviewed'))
  assert.ok(report.sourceStatuses.some((source) => source.supermarket === 'boni' &&
    source.m1PermissionStatus === 'not-in-m1'))
  assert.deepEqual(discovery, registry, 'discovery mutated')
  assert.deepEqual(m1, gate, 'M1 source evidence mutated')
})

test('Synthetic M1 permission changes cannot silently authorize the future M5 candidate list', () => {
  const [discovery, m1] = inputs()
  for (const source of m1.sources) {
    source.permissionStatus = 'permitted'
    source.productionEnabled = true
    source.evidence.push({
      kind: 'written_permission',
      url: 'https://example.invalid/fictional-only',
      finding: 'Synthetic validator contract input, not an actual permission grant',
    })
  }
  const report = reconcileRetailerRights(discovery, m1)
  assert.equal(report.m1ProductionReady, true, 'synthetic M1 validator fixture expected')
  assert.equal(report.m5Eligible, false)
  assert.equal(report.productionReady, false)
  assert.equal(report.blockedForM5, 17)
  assert.ok(report.sourceStatuses.every((source) => source.m5ProductionEnabled === false))
})

test('Missing M1 pair or M1 schema drift fails closed before a ready report', () => {
  const [missing, validM1] = inputs()
  missing.sources = missing.sources.filter((source) => source.id !== 'plus')
  assert.throws(() => reconcileRetailerRights(missing, validM1), /omitted an existing M1 retailer/)
  const [valid, wrongGate] = inputs()
  wrongGate.sources[0].permissionStatus = 'approved'
  assert.throws(() => reconcileRetailerRights(valid, wrongGate), /invalid permission status/)
})

test('Real CLI reads canonical snapshots, cannot be used as a release switch and writes no files', async () => {
  const cli = new URL('../scripts/m5-reconcile-retailer-rights.mjs', import.meta.url)
  const normal = spawnSync(process.execPath, [cli.pathname], { encoding: 'utf8', timeout: 20000 })
  assert.equal(normal.status, 0, normal.stderr)
  const report = JSON.parse(normal.stdout)
  assert.equal(report.m1BlockedCount, 2)
  assert.equal(report.blockedForM5, 17)
  assert.equal(report.productionReady, false)
  const requireGo = spawnSync(process.execPath, [cli.pathname, '--require-m5-ready'],
    { encoding: 'utf8', timeout: 20000 })
  assert.equal(requireGo.status, 2, requireGo.stderr)
  assert.equal(JSON.parse(requireGo.stdout).m5Eligible, false)
  const invalid = spawnSync(process.execPath, [cli.pathname, '--write'],
    { encoding: 'utf8', timeout: 20000 })
  assert.notEqual(invalid.status, 0)
  assert.equal(await readFile(discoveryUrl, 'utf8'), discoveryText)
  assert.equal(await readFile(gateUrl, 'utf8'), gateText)
})
