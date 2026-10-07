import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const policyUrl = new URL('../SECURITY.md', import.meta.url)

test('security policy routes sensitive reports privately without unsupported promises', async () => {
  const policy = await readFile(policyUrl, 'utf8')

  assert.match(policy, /private vulnerability reporting \/ security-advisory/i)
  assert.match(policy, /Do not publish credentials, personal data, exploit details, receipt images/i)
  assert.match(policy, /smallest reproducible description/i)
  assert.match(policy, /does not promise a response SLA, bounty, or reward/i)
})

test('security policy preserves third-party authorization and evidence boundaries', async () => {
  const policy = await readFile(policyUrl, 'utf8')

  assert.match(policy, /grant permission to actively test third-party retailers/i)
  assert.match(policy, /unless the system owner has explicitly authorized/i)
  assert.match(policy, /Retailer data reuse remains subject to SUPA's existing permission\/licensing gate/i)
  assert.match(policy, /not authorization for production scraping or intrusive verification/i)
  assert.match(policy, /Mock\/generated fixtures remain test material only/i)
  assert.match(policy, /issue #78/i)
})
