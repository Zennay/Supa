import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  isPublicDocumentaryEvidenceUrl, auditM3DocumentaryRights, main,
} from '../scripts/qa-m3-documentary-rights-audit-20261017.mjs'

const gatePath = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const executable = fileURLToPath(new URL('../scripts/qa-m3-documentary-rights-audit-20261017.mjs', import.meta.url))
const hostileQueries = [
  '%2561ccess_token=PRIVATE_FAKE_TOKEN',           // twice percent-encoded
  '%252561ccess_token=PRIVATE_FAKE_TOKEN',         // three layers
  'ACCESS%255fTOKEN=PRIVATE_FAKE_TOKEN',          // encoded separator
  'authToken=PRIVATE_FAKE_TOKEN',                 // camelCase token
  'code_verifier=PRIVATE_FAKE_TOKEN',             // PKCE verifier
  'samlResponse=PRIVATE_FAKE_TOKEN',             // SAML assertion
  'sessionId=PRIVATE_FAKE_TOKEN',                // session identifier
  'jwt=PRIVATE_FAKE_TOKEN',
  'ａｃｃｅｓｓ＿ｔｏｋｅｎ=PRIVATE_FAKE_TOKEN',    // NFKC compatibility
  '%E2%80%8Baccess_token=PRIVATE_FAKE_TOKEN',  // zero-width prefix
  'client%252dsecret=PRIVATE_FAKE_TOKEN',
]

async function syntheticPermission(url) {
  const doc = JSON.parse(await readFile(gatePath, 'utf8'))
  for (const source of doc.sources) {
    source.permissionStatus = 'permitted'
    source.productionEnabled = true
    source.evidence.push({
      kind: 'written_permission',
      url: source.supermarket === 'plus' ? url : 'https://example.invalid/fictional-licence',
      finding: 'Fictional QA licence only; not real rights.',
    })
  }
  return doc
}

test('encoded/camelCase/Unicode sensitive documentary query keys cannot be accepted as ordinary public references', async () => {
  for (const query of hostileQueries) {
    const url = 'https://example.invalid/document?' + query
    assert.equal(isPublicDocumentaryEvidenceUrl(url), false, query)
    const outcome = auditM3DocumentaryRights(await syntheticPermission(url))
    assert.equal(outcome.outcome, 'untrusted-documentary-url')
    assert.equal(outcome.unsafeDocumentaryUrls, 1)
    assert.equal(outcome.underlyingGateClaimsReady, true)
    assert.equal(outcome.productionReady, false)
    assert.equal(outcome.publicSavingsClaimEligible, false)
    assert.equal(outcome.liveRequests, 0)
    assert.equal(outcome.releaseDecision, 'hold')
    assert.doesNotMatch(JSON.stringify(outcome), /PRIVATE_FAKE_TOKEN|authToken|jwt|access_token|https:/u)
  }
})

test('bare query delimiter and disguised credential keys cannot manufacture documentary rights', () => {
  for (const url of [
    'https://example.invalid/document?',
    'https://example.invalid/document?%252561uth%25255ftoken=fictional',
    'https://example.invalid/document?client_secret=fictional',
  ]) assert.equal(isPublicDocumentaryEvidenceUrl(url), false, url)
})

test('ordinary public HTTPS documentary URL query keys remain syntactically accepted', () => {
  for (const url of [
    'https://example.invalid/document',
    'https://example.invalid/document?locale=nl&revision=2026',
    'https://example.invalid/document?ref=terms-2026',
    'https://www.dekamarkt.nl/algemene-voorwaarden?lang=nl',
  ]) assert.equal(isPublicDocumentaryEvidenceUrl(url), true, url)
})

test('canonical actual PLUS/Deka rights remain denied without data leakage or network', async () => {
  const canonical = JSON.parse(await readFile(gatePath, 'utf8'))
  const result = auditM3DocumentaryRights(canonical)
  assert.equal(result.productionReady, false)
  assert.equal(result.underlyingGateClaimsReady, false)
  assert.equal(result.releaseDecision, 'hold')
  assert.equal(result.unsafeDocumentaryUrls, 0)
  let stdout = ''
  await main([], text => { stdout += text })
  assert.equal(JSON.parse(stdout).releaseDecision, 'hold')
  const strict = spawnSync(process.execPath, [executable, '--require-release'], {
    encoding: 'utf8', timeout: 15000,
  })
  assert.equal(strict.status, 2, strict.stderr)
  assert.equal(JSON.parse(strict.stdout).publicSavingsClaimEligible, false)
  assert.equal(strict.stderr, '')
})
