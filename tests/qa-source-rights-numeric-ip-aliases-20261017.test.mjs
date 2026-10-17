import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'

import { evaluateSourcePermissionGate } from '../scripts/m1-check-source-permission-gate.mjs'

// Independent add-only QA1/2 on frozen source-rights test DRAFT #3781.
// These are syntactic URLs in a wholly invented private JSON permission
// registry. NO DNS, HTTP, supermarket contact or actual permission grant.
// Browser URL parsers accept multiple numeric host spellings for the very
// same restricted IP; a private source must not be made public by an alias.
const canonical = new URL('../evidence/m1/source-permission-gate.v1.json', import.meta.url)
const simulatedWrittenLicense = 'Fictional test-only reference; never a grant.'

async function fixture(link) {
  const doc = JSON.parse(await readFile(canonical, 'utf8'))
  for (const source of doc.sources) {
    source.permissionStatus = 'permitted'
    source.productionEnabled = true
    source.evidence.push({
      kind: 'written_permission',
      url: source.supermarket === 'plus' ? link : 'https://example.invalid/test-only-license',
      finding: simulatedWrittenLicense,
    })
  }
  return doc
}

test('positive: actual PLUS and DekaMarkt permission statuses remain unapproved', async () => {
  const document = JSON.parse(await readFile(canonical, 'utf8'))
  assert.equal(evaluateSourcePermissionGate(document).productionReady, false)
})

test('positive: ordinary HTTPS synthetic documentation remains structurally compatible', async () => {
  const doc = await fixture('https://example.invalid/fictional-license')
  assert.equal(evaluateSourcePermissionGate(doc).productionReady, true,
    'positive is ONLY a compatibility control on artificial records, not real rights')
})

for (const [name, input, expectedHost] of [
  ['decimal 32-bit IPv4 loopback', 'https://2130706433/fictional-license', '127.0.0.1'],
  ['hexadecimal IPv4 loopback', 'https://0x7f000001/fictional-license', '127.0.0.1'],
  ['octal IPv4 loopback', 'https://0177.0.0.1/fictional-license', '127.0.0.1'],
  ['short IPv4 loopback', 'https://127.1/fictional-license', '127.0.0.1'],
  ['mixed numeric IPv4 loopback', 'https://0x7f.1/fictional-license', '127.0.0.1'],
  ['numeric IPv4 metadata host', 'https://0xa9fea9fe/fictional-license', '169.254.169.254'],
  ['IPv4 mapped IPv6 loopback', 'https://[::ffff:127.0.0.1]/fictional-license', '[::ffff:7f00:1]'],
  ['IPv4 mapped IPv6 private', 'https://[::ffff:10.0.0.2]/fictional-license', '[::ffff:a00:2]'],
  ['IPv6 link-local', 'https://[fe80::1]/fictional-license', '[fe80::1]'],
]) {
  test('P1 #3782: reject numeric/private rights-origin alias: ' + name, async () => {
    const parsed = new URL(input)
    assert.equal(parsed.protocol, 'https:')
    assert.equal(parsed.hostname, expectedHost,
      'URL parser canonicalization proves this label denotes a nonpublic endpoint')
    assert.throws(() => evaluateSourcePermissionGate(await fixture(input)),
      /evidence|authorization|source URL|non-public|private|origin|credential|invalid/i,
      'permission grant evidence must not trust alternate spellings of nonpublic origin')
  })
}
