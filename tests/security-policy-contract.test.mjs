import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const policy = await readFile('SECURITY.md', 'utf8')

test('security policy keeps sensitive reports off public issues', () => {
  assert.match(policy, /do not publish sensitive vulnerability details/i)
  assert.match(policy, /private vulnerability reporting|security advisory/i)
  assert.match(policy, /credentials/i)
  assert.match(policy, /personal data|personal information/i)
})

test('security policy requires authorization for third-party active testing', () => {
  assert.match(policy, /do not grant permission/i)
  assert.match(policy, /PLUS/)
  assert.match(policy, /DekaMarkt/)
  assert.match(policy, /explicit authorization/i)
  assert.match(policy, /active security testing/i)
})

test('security policy preserves retailer evidence and licensing boundaries', () => {
  assert.match(policy, /must not be used to fabricate retailer observations/i)
  assert.match(policy, /production reuse remains separately permission\/licensing gated/i)
  assert.match(policy, /does not promise a vulnerability-response SLA, bounty, or reward/i)
})
