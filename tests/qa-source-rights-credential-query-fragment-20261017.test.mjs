import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import { evaluateSourcePermissionGate } from '../scripts/m1-check-source-permission-gate.mjs'

// QA1/2: source-rights documentary evidence is never a credential carrier.
// Entirely fictional permission documents and example.invalid HTTPS URLs;
// no DNS, HTTP, supermarket calls, actual licences or real credentials.
const fixtureUrl = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const EXAMPLE = 'https://example.invalid/licence'
const SECRET = 'synthetic-test-only-not-a-real-credential'

async function register(url) {
  const doc = JSON.parse(await readFile(fixtureUrl, 'utf8'))
  for (const item of doc.sources) {
    item.permissionStatus = 'permitted'
    item.productionEnabled = true
    item.evidence.push({
      kind: 'written_permission',
      url: item.supermarket === 'plus' ? url : EXAMPLE,
      finding: 'Fictional non-grant used solely to verify URL hygiene.',
    })
  }
  return doc
}

test('positive: actual canonical PLUS/Deka permission register remains denied', async () => {
  const doc = JSON.parse(await readFile(fixtureUrl, 'utf8'))
  const outcome = evaluateSourcePermissionGate(doc)
  assert.equal(outcome.productionReady, false)
})

for (const [name, url] of [
  ['ordinary documentation section query', EXAMPLE + '?section=permissions'],
  ['ordinary documentation fragment anchor', EXAMPLE + '#terms-and-conditions'],
]) {
  test('positive: harmless documentary URL reference stays structurally acceptable: ' + name, async () => {
    const doc = await register(url)
    assert.equal(evaluateSourcePermissionGate(doc).productionReady, true,
      'fictional compatibility only, never a licence for real PLUS/Deka ingestion')
  })
}

for (const [name, url] of [
  ['OAuth bearer token query', EXAMPLE + '?access_token=' + SECRET],
  ['API secret key query', EXAMPLE + '?api_key=' + SECRET],
  ['OAuth authorization-code query', EXAMPLE + '?code=' + SECRET + '&state=fictional'],
  ['case-insensitive credential query', EXAMPLE + '?AcCeSs_ToKeN=' + SECRET],
  ['percent-encoded credential parameter', EXAMPLE + '?access%5Ftoken=' + SECRET],
  ['fragment access token', EXAMPLE + '#access_token=' + SECRET],
  ['fragment ID token', EXAMPLE + '#id_token=' + SECRET],
]) {
  test('P1 #3782: rights proof URL must reject credential channel: ' + name, async () => {
    const parsed = new URL(url)
    assert.equal(parsed.protocol, 'https:')
    assert.equal(parsed.hostname, 'example.invalid')
    const doc = await register(url)
    assert.throws(() => evaluateSourcePermissionGate(doc),
      /evidence|authorization|source URL|token|private|credential|invalid/i,
      'credentials never serve as evidence that a retailer granted production rights')
  })
}
