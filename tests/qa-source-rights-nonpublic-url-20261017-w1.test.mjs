// SUPA quality-validation 1/2. Source rights are legal/operational claims,
// NOT arbitrary HTTPS links. These entirely fictional records test whether the
// local rights gate mistakes a loopback, private, link-local, metadata-service
// or credential-bearing URL for a valid source authorization reference.
// No HTTP/DNS/retailer access and NO claim of an actual legal permission.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { evaluateSourcePermissionGate } from '../scripts/m1-check-source-permission-gate.mjs'

const gateFixture = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const script = new URL('../scripts/m1-check-source-permission-gate.mjs', import.meta.url)

async function currentRegistry() {
  return JSON.parse(await readFile(gateFixture, 'utf8'))
}

function syntheticBothPermitted(leftUrl, rightUrl = 'https://example.invalid/test-only-written-approval') {
  return currentRegistry().then(doc => {
    for (const source of doc.sources) {
      source.permissionStatus = 'permitted'
      source.productionEnabled = true
      source.evidence.push({
        kind: 'written_permission',
        url: source.supermarket === 'plus' ? leftUrl : rightUrl,
        finding: 'Purely fictional unit-test string, not a permission grant.',
      })
    }
    return doc
  })
}

test('canonical PLUS and DekaMarkt rights remain denied, including the official fixture', async () => {
  const doc = await currentRegistry()
  const report = evaluateSourcePermissionGate(doc)
  assert.equal(report.productionReady, false)
  assert.deepEqual(report.blockers.map(x => [x.supermarket, x.permissionStatus]), [
    ['plus', 'permission_required'], ['dekamarkt', 'unresolved'],
  ])
})

test('ordinary HTTPS documentation links in hypothetical TEST-only permissions retain legacy support', async () => {
  const doc = await syntheticBothPermitted('https://example.invalid/permission-record')
  const report = evaluateSourcePermissionGate(doc)
  // This is a synthetic compatibility control ONLY, never an approval of
  // the canonical PLUS/DekaMarkt source licensing or a real deployment.
  assert.equal(report.productionReady, true)
})

for (const forbidden of [
  'https://localhost/fictional-license',
  'https://localhost./fictional-license',
  'https://127.0.0.1/fictional-license',
  'https://10.0.0.2/fictional-license',
  'https://192.168.1.2/fictional-license',
  'https://169.254.169.254/latest/meta-data/fictional-license',
  'https://[::1]/fictional-license',
  'https://[fc00::1]/fictional-license',
  'https://person:secret@example.invalid/fictional-license',
]) {
  test(`private/credential source permission evidence is rejected: ${forbidden.replace(/secret/, '[REDACTED]')}`, async () => {
    const doc = await syntheticBothPermitted(forbidden)
    assert.throws(() => evaluateSourcePermissionGate(doc),
      /evidence|authorization|source URL|non-public|private|credential|safe|invalid/i)
  })
}

test('production-readiness CLI cannot affirm a loopback-backed fictional license record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'supa-rights-qa-no-loopback-'))
  try {
    const path = join(directory, 'fictional-registry.json')
    const doc = await syntheticBothPermitted('https://127.0.0.1/fictional-license')
    await writeFile(path, JSON.stringify(doc), { mode: 0o600 })
    const result = spawnSync(process.execPath, [script.pathname, '--require-production-ready'], {
      encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, SUPA_SOURCE_PERMISSION_GATE: path },
    })
    assert.notEqual(result.status, 0)
    assert.doesNotMatch(result.stdout, /"productionReady"\s*:\s*true/)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
