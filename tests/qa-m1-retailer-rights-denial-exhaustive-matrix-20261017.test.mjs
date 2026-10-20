import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { evaluateSourcePermissionGate } from '../scripts/m1-check-source-permission-gate.mjs'

// Independent GREEN QA on current protected-main source only.
// This is a model of denied rights, NOT a licence, real permission, user
// record or request to any supermarket. No network calls.
const REGISTRY = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const DENIALS = ['permission_required', 'unresolved', 'prohibited']
const FICTITIOUS_GRANT = Object.freeze({
  kind: 'written_permission',
  url: 'https://example.invalid/synthetic-consent-test-only',
  finding: 'Fictional assertion used solely for testing. No actual licence exists.',
})

async function registry() {
  return JSON.parse(await readFile(REGISTRY, 'utf8'))
}

function caseFor(record, state) {
  record.permissionStatus = state.status
  record.productionEnabled = state.enabled
  if (state.injectedGrant) record.evidence.push({ ...FICTITIOUS_GRANT })
}

function outcomes() {
  return DENIALS.flatMap(status =>
    [false, true].flatMap(enabled =>
      [false, true].map(injectedGrant => ({ status, enabled, injectedGrant }))))
}

test('M3 source-rights denial matrix: all 288 combinations remain blocked or fail closed', async () => {
  const baseline = await registry()
  let trials = 0
  let refusal = 0
  let safelyBlocked = 0
  for (const plus of outcomes()) {
    for (const deka of outcomes()) {
      for (const swapOrder of [false, true]) {
        const document = structuredClone(baseline)
        if (swapOrder) document.sources.reverse()
        caseFor(document.sources.find(x => x.supermarket === 'plus'), plus)
        caseFor(document.sources.find(x => x.supermarket === 'dekamarkt'), deka)
        const originalBytes = JSON.stringify(document)
        const label = JSON.stringify({ plus, deka, swapOrder })
        let result
        try {
          result = evaluateSourcePermissionGate(document)
        } catch (error) {
          refusal++
          assert.equal(plus.enabled || deka.enabled, true,
            'unmodified statuses with both sources disabled must never be refused: ' + label)
          assert.match(error.message, /production ingestion must stay disabled/,
            'only the already-invalid enabled-without-permission cases may throw: ' + label)
        }
        if (result !== undefined) {
          safelyBlocked++
          assert.equal(plus.enabled || deka.enabled, false,
            'enabling even one denied source must never return a report: ' + label)
          assert.equal(result.productionReady, false, label)
          assert.deepEqual(result.expectedSources, ['dekamarkt', 'plus'], label)
          const blockers = result.blockers
            .map(x => [x.supermarket, x.permissionStatus, x.productionEnabled])
            .sort(([a], [b]) => a.localeCompare(b))
          assert.deepEqual(blockers, [
            ['dekamarkt', deka.status, false],
            ['plus', plus.status, false],
          ], label)
        }
        assert.equal(JSON.stringify(document), originalBytes,
          'the rights gate must not alter a provided permission register: ' + label)
        trials++
      }
    }
  }
  assert.equal(trials, 288)
  assert.equal(refusal, 216, 'every combination enabling a denied source must refuse')
  assert.equal(safelyBlocked, 72, 'all 72 no-production cases must return two blockers')
})

test('M3 rights revocation: a fictional two-store approval is not sticky after either source loses permission', async () => {
  const baseline = await registry()
  for (const source of baseline.sources) {
    source.permissionStatus = 'permitted'
    source.productionEnabled = true
    source.evidence.push({ ...FICTITIOUS_GRANT })
  }
  // Model compatibility only: this positive fictional document is not real consent.
  assert.equal(evaluateSourcePermissionGate(baseline).productionReady, true)
  let checks = 0
  for (const supermarket of ['plus', 'dekamarkt']) {
    for (const deniedStatus of DENIALS) {
      const revoked = structuredClone(baseline)
      const source = revoked.sources.find(x => x.supermarket === supermarket)
      source.permissionStatus = deniedStatus
      assert.throws(() => evaluateSourcePermissionGate(revoked),
        /production ingestion must stay disabled/,
        'a stale productionEnabled=true must never outlive revocation')
      source.productionEnabled = false
      const report = evaluateSourcePermissionGate(revoked)
      assert.equal(report.productionReady, false)
      assert.equal(report.blockers.length, 1)
      assert.equal(report.blockers[0].supermarket, supermarket)
      assert.equal(report.blockers[0].permissionStatus, deniedStatus)
      checks++
    }
  }
  assert.equal(checks, 6)
})

test('M3 canonical repository gate: both real retailers continue denied without invented authorization', async () => {
  const current = await registry()
  assert.equal(current.sources.some(x => x.productionEnabled), false)
  assert.deepEqual(
    evaluateSourcePermissionGate(current).blockers.map(x => [x.supermarket, x.permissionStatus]),
    [['plus', 'permission_required'], ['dekamarkt', 'unresolved']],
  )
})
