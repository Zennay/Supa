// Independent black-box QA of the standalone, non-publishing M3
// documentary evidence operator audit. No external HTTP, DNS, retailer
// capture, customer info, price, or actual permission is used by this suite.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import {
  auditM3DocumentaryRights,
  isPublicDocumentaryEvidenceUrl,
  main,
} from '../scripts/qa-m3-documentary-rights-audit-20261017.mjs'
import { evaluateSourcePermissionGate } from '../scripts/m1-check-source-permission-gate.mjs'

const fixture = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const executable = fileURLToPath(new URL(
  '../scripts/qa-m3-documentary-rights-audit-20261017.mjs', import.meta.url))

async function originalDocument() {
  return JSON.parse(await readFile(fixture, 'utf8'))
}

async function fictionalPermissions(url) {
  const document = await originalDocument()
  for (const source of document.sources) {
    source.permissionStatus = 'permitted'
    source.productionEnabled = true
    source.evidence.push({
      kind: 'written_permission',
      url: source.supermarket === 'plus' ? url : 'https://example.invalid/example-fake-approval',
      finding: 'Synthetic record for QA only, never a licence.',
    })
  }
  return document
}

test('real current retailer rights are a private HOLD with no independent licensing approval', async () => {
  const doc = await originalDocument()
  const before = JSON.stringify(doc)
  const original = evaluateSourcePermissionGate(doc)
  assert.equal(original.productionReady, false)
  assert.deepEqual(original.blockers.map(row => [row.supermarket, row.permissionStatus]), [
    ['plus', 'permission_required'],
    ['dekamarkt', 'unresolved'],
  ])
  const result = auditM3DocumentaryRights(doc)
  assert.equal(result.outcome, 'retailer-permission-not-yet-established')
  assert.equal(result.underlyingGateClaimsReady, false)
  assert.equal(result.reviewedSourceCount, 2)
  assert.equal(result.unsafeDocumentaryUrls, 0)
  assert.equal(result.independentlyVerifiedLegalRights, false)
  assert.equal(result.requiresHumanLegalReview, true)
  assert.equal(result.productionReady, false)
  assert.equal(result.releaseDecision, 'hold')
  assert.equal(result.liveRequests, 0)
  assert.equal(result.publicSavingsClaimEligible, false)
  assert.equal(JSON.stringify(doc), before)
})

test('even a synthetic normal HTTPS written_permission cannot self-certify legal rights', async () => {
  const fake = await fictionalPermissions('https://example.invalid/fake-written-permission')
  // Legacy positive fixture compatibility: the *existing* gate accepts a
  // synthetic source declaration; the independent QA audit DOES NOT.
  assert.equal(evaluateSourcePermissionGate(fake).productionReady, true)
  const independent = auditM3DocumentaryRights(fake)
  assert.equal(independent.outcome, 'requires-independent-licence-review')
  assert.equal(independent.underlyingGateClaimsReady, true)
  assert.equal(independent.unsafeDocumentaryUrls, 0)
  assert.equal(independent.productionReady, false)
  assert.equal(independent.releaseDecision, 'hold')
  assert.equal(independent.independentlyVerifiedLegalRights, false)
})

for (const url of [
  'https://localhost/fake',
  'https://localhost./fake',
  'https://internal.local/fake',
  'https://permission.internal/fake',
  'https://127.0.0.1/fake',
  'https://10.0.0.1/fake',
  'https://192.168.1.2/fake',
  'https://169.254.169.254/latest/meta-data',
  'https://[::1]/fake',
  'https://[fc00::1]/fake',
  'https://www.example.invalid:8443/fake',
  'https://user:secret@example.invalid/fake',
  'https://example.invalid/doc?access_token=fictional-secret',
  'https://example.invalid/doc?client_secret=fictional-secret',
  'https://example.invalid/doc#hidden',
]) {
  test(`static untrusted documentary URL is detected without permission promotion (${url.replace(/secret/g, 'redacted')})`, async () => {
    assert.equal(isPublicDocumentaryEvidenceUrl(url), false)
    const doc = await fictionalPermissions(url)
    const result = auditM3DocumentaryRights(doc)
    assert.equal(result.outcome, 'untrusted-documentary-url')
    assert.equal(result.unsafeDocumentaryUrls, 1)
    assert.equal(result.underlyingGateClaimsReady, true)
    assert.equal(result.productionReady, false)
    assert.equal(result.releaseDecision, 'hold')
    assert.equal(result.liveRequests, 0)
    assert.equal(result.independentlyVerifiedLegalRights, false)
    const output = JSON.stringify(result)
    assert.doesNotMatch(output, /fictional-secret|access_token|client_secret|https:\/\//)
  })
}

test('known official HTTPS documentary shapes and synthetic positive control stay syntactically accepted', () => {
  assert.equal(isPublicDocumentaryEvidenceUrl('https://taarten.plus.nl/alv/'), true)
  assert.equal(isPublicDocumentaryEvidenceUrl('https://www.dekamarkt.nl/algemene-voorwaarden'), true)
  assert.equal(isPublicDocumentaryEvidenceUrl('https://example.invalid/permission-record'), true)
  // Syntactic acceptance is NEVER equivalent to human approval.
})

test('actual CLI emits only aggregate HOLD information and never a retailer URL or price', async () => {
  let stdout = ''
  const report = await main([], value => { stdout += value })
  assert.deepEqual(JSON.parse(stdout), report)
  assert.equal(report.productionReady, false)
  assert.equal(report.releaseDecision, 'hold')
  assert.doesNotMatch(stdout, /https:\/\/|taarten\.plus|dekamarkt\.nl|priceCents|snapshotSha256/i)
  await assert.rejects(main(['--publish']), /Independent M3 documentary rights audit refused/)
})

test('actual executable strict release invocation exits nonzero, without claiming approval', () => {
  const normal = spawnSync(process.execPath, [executable],
    { encoding: 'utf8', timeout: 20_000 })
  assert.equal(normal.status, 0, normal.stderr)
  assert.equal(JSON.parse(normal.stdout).releaseDecision, 'hold')

  const strict = spawnSync(process.execPath, [executable, '--require-release'],
    { encoding: 'utf8', timeout: 20_000 })
  assert.equal(strict.status, 2, strict.stderr)
  assert.equal(strict.stderr, '')
  const report = JSON.parse(strict.stdout)
  assert.equal(report.productionReady, false)
  assert.equal(report.releaseDecision, 'hold')
  assert.equal(report.underlyingGateClaimsReady, false)
  assert.equal(report.liveRequests, 0)
})
