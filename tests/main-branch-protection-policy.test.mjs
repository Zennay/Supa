import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const policy = JSON.parse(
  readFileSync(
    new URL('../docs/quality/main-branch-protection-policy.json', import.meta.url),
    'utf8',
  ),
)

test('main branch protection target stays explicit and non-deceptive', () => {
  assert.equal(policy.schemaVersion, 1)
  assert.equal(policy.scope?.branch, 'main')
  assert.equal(policy.status?.kind, 'descriptive-target')
  assert.equal(
    policy.status?.enforced,
    false,
    'checked-in policy must not claim GitHub settings are enforced',
  )
  assert.equal(policy.status?.trackingIssue, 411)
})

test('main branch policy requires the stable hosted landing gate only', () => {
  assert.equal(policy.landing?.requirePullRequest, true)
  assert.deepEqual(policy.landing?.requiredHostedChecks, ['test-build'])
  assert.equal(
    policy.landing?.pathConditionalPermanentChecksGloballyRequired,
    false,
    'path-conditional permanent VPS/browser checks must not become global merge requirements',
  )
})

test('main branch policy protects history and preserves audited recovery', () => {
  assert.equal(policy.history?.allowForcePush, false)
  assert.equal(policy.history?.allowDeletion, false)

  assert.equal(
    policy.recovery?.repositoryAdministratorMayTemporarilyAdjust,
    true,
  )
  assert.equal(policy.recovery?.reasonMustBeRecorded, true)
  assert.equal(policy.recovery?.restorePolicyAfterRecovery, true)
})
