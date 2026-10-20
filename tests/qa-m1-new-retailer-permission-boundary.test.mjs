import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { evaluateSourcePermissionGate } from '../scripts/m1-check-source-permission-gate.mjs'

const fixtureUrl = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const gateScript = fileURLToPath(new URL('../scripts/m1-check-source-permission-gate.mjs', import.meta.url))

function fixture() {
  return JSON.parse(readFileSync(fixtureUrl, 'utf8'))
}

function authorizedClone(source) {
  return {
    ...structuredClone(source),
    permissionStatus: 'permitted',
    productionEnabled: true,
    evidence: [
      ...structuredClone(source.evidence),
      {
        kind: 'written_permission',
        url: 'https://example.invalid/fictional-license',
        finding: 'FICTIONAL CONTRACT TEST ONLY; NEVER A REAL PERMISSION',
      },
    ],
  }
}

test('canonical unapproved PLUS and DekaMarkt pair stays disabled and names every blocker', () => {
  const before = readFileSync(fixtureUrl, 'utf8')
  const result = evaluateSourcePermissionGate(fixture())
  assert.equal(result.productionReady, false)
  assert.deepEqual(result.expectedSources, ['dekamarkt', 'plus'])
  assert.deepEqual(result.blockers.map((entry) => entry.supermarket), ['plus', 'dekamarkt'])
  assert.ok(result.blockers.every((entry) => entry.productionEnabled === false))
  assert.deepEqual(readFileSync(fixtureUrl, 'utf8'), before)
})

test('prospective M5 supermarket additions fail closed even when claimed approved or licensed', () => {
  // The existing M1 gate covers precisely two approved *research targets*.
  // New stores belong to a separate explicit registry/permission review, not
  // a silent addition to an older two-retailer permission artifact.
  for (const supermarket of [
    'albert-heijn', 'jumbo', 'lidl', 'aldi', 'dirk', 'vomar',
    'hoogvliet', 'spar', 'poiesz', 'boni', 'picnic',
  ]) {
    const document = fixture()
    document.sources.push({
      ...authorizedClone(document.sources[0]),
      supermarket,
    })
    assert.throws(
      () => evaluateSourcePermissionGate(document),
      /unexpected source in permission gate/,
      supermarket,
    )
  }
})

test('identical and differently ordered extra source rows do not bypass the two-source identity gate', () => {
  const document = fixture()
  document.sources.push(structuredClone(document.sources[0]))
  assert.throws(() => evaluateSourcePermissionGate(document), /duplicate source in permission gate/)
  const missing = fixture()
  missing.sources = missing.sources.filter((source) => source.supermarket !== 'plus')
  assert.throws(() => evaluateSourcePermissionGate(missing), /permission gate must cover exactly/)
  const reordered = fixture()
  reordered.sources.reverse()
  assert.equal(evaluateSourcePermissionGate(reordered).productionReady, false)
})

test('future M5 style statuses are not retroactively treated as approved M1 permission', () => {
  for (const status of ['approved', 'pending', 'denied', 'unknown', '', null]) {
    const document = fixture()
    document.sources[0].permissionStatus = status
    document.sources[0].productionEnabled = true
    assert.throws(
      () => evaluateSourcePermissionGate(document),
      /invalid permission status/,
      String(status),
    )
  }
})

test('official public terms, technical proof and HTTPS-only accessibility cannot imply reuse permission', () => {
  for (const enabled of [false, true]) {
    const document = fixture()
    const plus = document.sources[0]
    plus.permissionStatus = 'permitted'
    plus.productionEnabled = enabled
    assert.throws(
      () => evaluateSourcePermissionGate(document),
      /cannot be marked permitted without explicit authorization evidence/,
    )
  }
})

test('prohibited and unresolved sources cannot be enabled even beside fictional authorized source', () => {
  for (const disallowed of ['prohibited', 'unresolved', 'permission_required']) {
    const document = fixture()
    document.sources[0] = authorizedClone(document.sources[0])
    document.sources[1].permissionStatus = disallowed
    document.sources[1].productionEnabled = true
    assert.throws(
      () => evaluateSourcePermissionGate(document),
      /production ingestion must stay disabled while permission is/,
    )
  }
  const document = fixture()
  document.sources[0] = authorizedClone(document.sources[0])
  const result = evaluateSourcePermissionGate(document)
  assert.equal(result.productionReady, false)
  assert.equal(result.blockers.length, 1)
  assert.equal(result.blockers[0].supermarket, 'dekamarkt')
})

test('permission evidence rejects insecure, relative or malformed URLs before licensing is considered', () => {
  for (const url of [
    'http://example.invalid/permission',
    'file:///tmp/private-license',
    'javascript:alert(1)',
    '/relative-permission',
    'https://',
    '',
  ]) {
    const document = fixture()
    document.sources[0].evidence[0].url = url
    assert.throws(
      () => evaluateSourcePermissionGate(document),
      /evidence requires an HTTPS source URL/,
      url,
    )
  }
})

test('production-ready command fails on unchanged real permission gate, without touching evidence', () => {
  const before = readFileSync(fixtureUrl, 'utf8')
  const command = spawnSync(process.execPath, [gateScript, '--require-production-ready'], {
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      SUPA_SOURCE_PERMISSION_GATE: fileURLToPath(fixtureUrl),
    },
  })
  assert.equal(command.status, 2, command.stderr)
  assert.equal(command.stderr, '')
  const summary = JSON.parse(command.stdout)
  assert.equal(summary.productionReady, false)
  assert.deepEqual(summary.expectedSources, ['dekamarkt', 'plus'])
  assert.equal(summary.blockers.length, 2)
  assert.deepEqual(readFileSync(fixtureUrl, 'utf8'), before)
})
