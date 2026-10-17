import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  extractM3PullRequestPaths,
  selectorCoversM3File,
  collectM3TriggerCandidates,
  auditM3TriggerClosure,
  main,
} from '../scripts/qa-m3-permanent-runner-trigger-inventory-20261017.mjs'

// Never modify the source workflow owned by PR #2604, call the real
// self-hosted runner, fetch retailer HTML or manufacture external evidence.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOW_PATH = '.github/workflows/m3-observed-week-report.yml'
const workflow = await readFile(resolve(ROOT, WORKFLOW_PATH), 'utf8')
const inventory = await collectM3TriggerCandidates(ROOT)
const staticAudit = () => auditM3TriggerClosure(workflow, inventory)

test('actual current main inventory exposes actionable missing M3 paths without implying a VPS run or release', () => {
  const report = staticAudit()
  assert.equal(report.candidatePathCount, inventory.length)
  assert.equal(report.coveredPathCount + report.missingPathCount, inventory.length)
  assert.equal(report.missingPaths.length, report.missingPathCount)
  assert.equal(new Set(report.missingPaths).size, report.missingPathCount)
  assert.deepEqual(report.missingPaths, [...report.missingPaths].sort(
    (a, b) => a.localeCompare(b, 'en')))
  assert.ok(report.candidatePathCount > 200, 'M3 has a broad existing source/test surface')
  assert.ok(report.missingPathCount > 10, 'release blocker remains unresolved')
  for (const path of [
    'scripts/qa-m3-field-run-code-pin-20261017.mjs',
    'scripts/qa-m3-field-run-code-pin-cli-20261017.mjs',
    'tests/qa-m3-field-run-code-pin-private-cli-20261017.test.mjs',
    'tests/qa-m3-codepin-all-physical-lines-metamorphic-20261017.test.mjs',
    'tests/qa-m3-codepin-cli-three-file-private-input-matrix-20261017.test.mjs',
    'tests/qa-m3-codepin-unknown-basket-availability-20261017.test.mjs',
  ]) {
    assert.ok(report.missingPaths.includes(path), 'exact newly merged test/source missed: ' + path)
  }
  assert.equal(report.pathCoverageComplete, false)
  assert.equal(report.selfHostedRunnerExecutedAndAttested, false)
  assert.equal(report.legalRetailerRightsVerified, false)
  assert.equal(report.genuinePairedObservationVerified, false)
  assert.equal(report.sourceCodePinPersistedAndVerified, false)
  assert.equal(report.productionReady, false)
  assert.equal(report.publicSavingsClaimEligible, false)
  assert.equal(report.m3ExitProven, false)
  assert.equal(report.releaseDecision, 'hold-permanent-m3-vps-trigger-coverage')
})

test('simulate full exact-path remediation on in-memory YAML only: coverage turns GREEN but no real gate does', () => {
  const before = staticAudit()
  const unique = before.missingPaths
  const repaired = workflow.replace('  workflow_dispatch:',
    unique.map(x => '      - "' + x + '"').join('\n') + '\n  workflow_dispatch:')
  assert.notEqual(repaired, workflow)
  const after = auditM3TriggerClosure(repaired, inventory)
  assert.equal(after.missingPathCount, 0)
  assert.equal(after.pathCoverageComplete, true)
  assert.equal(after.candidatePathCount, before.candidatePathCount)
  assert.equal(after.selfHostedRunnerExecutedAndAttested, false)
  assert.equal(after.productionReady, false)
  assert.equal(after.m3ExitProven, false)
  assert.equal(after.publicSavingsClaimEligible, false)
  // Mutating one exact trigger after a complete synthetic repair must
  // reinstate a missing path, without rewriting the live owner workflow.
  for (const removedPath of unique.slice(0, 12)) {
    const mutant = repaired.replace('      - "' + removedPath + '"\n', '')
    const audit = auditM3TriggerClosure(mutant, inventory)
    assert.equal(audit.missingPathCount, 1, removedPath)
    assert.ok(audit.missingPaths.includes(removedPath))
  }
})

test('compact namespace-scoped owner review proposal spans missing sources without untrusted broad triggers', () => {
  const before = staticAudit()
  const proposals = before.ownerReviewCandidateSelectors
  assert.ok(proposals.length >= 5 && proposals.length <= 12,
    'focused permanent-runner remediation should not need hundreds of YAML edits')
  assert.equal(before.ownerReviewRequiredBeforeWorkflowChange, true)
  assert.equal(new Set(proposals).size, proposals.length)
  for (const pattern of proposals) {
    assert.ok(!['**', 'tests/**', 'scripts/**', 'src/**'].includes(pattern))
    assert.ok(before.missingPaths.some(path => selectorCoversM3File(path, pattern)),
      'every proposed selector actually repairs a current gap')
  }
  const simulated = workflow.replace('  workflow_dispatch:',
    proposals.map(s => '      - "' + s + '"').join('\n') + '\n  workflow_dispatch:')
  const outcome = auditM3TriggerClosure(simulated, inventory)
  assert.equal(outcome.missingPathCount, 0)
  assert.equal(outcome.pathCoverageComplete, true)
  assert.equal(outcome.selfHostedRunnerExecutedAndAttested, false)
  assert.equal(outcome.productionReady, false)
  // The owner is free to choose a different secure allowlist strategy.
  for (const selector of proposals) {
    const mutant = simulated.replace('      - "' + selector + '"\n', '')
    assert.ok(auditM3TriggerClosure(mutant, inventory).missingPathCount > 0,
      'every review candidate is material in this synthetic patch: ' + selector)
  }
})

test('scoped M3 globs cover only their own trees; broad wildcards never stand in for security review', () => {
  assert.equal(selectorCoversM3File(
    'tests/qa-m3-codepin-unknown-basket-availability-20261017.test.mjs',
    'tests/qa-m3-*.test.mjs'), true)
  assert.equal(selectorCoversM3File(
    'tests/product-m3-paper-field-run-revision-20261015.test.mjs',
    'tests/qa-m3-*.test.mjs'), false)
  assert.equal(selectorCoversM3File(
    'scripts/qa-m3-field-run-code-pin-cli-20261017.mjs',
    'scripts/qa-m3-*.mjs'), true)
  assert.equal(selectorCoversM3File(
    'src/features/observation/ObservationView.tsx',
    'src/features/observation/**'), true)
  assert.equal(selectorCoversM3File(
    'scripts/m1-check-source-permission-gate.mjs',
    'src/features/observation/**'), false)
  for (const unsafe of ['**', 'tests/**', 'scripts/**', 'src/**', 'tests/*']) {
    assert.equal(selectorCoversM3File('tests/qa-m3-any.test.mjs', unsafe), false, unsafe)
  }
  const tooBroad = workflow.replace('  workflow_dispatch:',
    '      - "tests/**"\n  workflow_dispatch:')
  const audit = auditM3TriggerClosure(tooBroad, inventory)
  assert.equal(audit.pathCoverageComplete, false)
  assert.deepEqual(audit.broadOrUnreviewedWildcardSelectors, ['tests/**'])
})

test('guarded parser reads only the real pull_request.paths list, not comments, workflow body or labels', () => {
  const selectors = extractM3PullRequestPaths(workflow)
  assert.ok(selectors.length > 20)
  assert.ok(selectors.includes(WORKFLOW_PATH))
  const decoy = workflow.replace('  workflow_dispatch:',
    '      # tests/private-fake.test.mjs\n  workflow_dispatch:')
  assert.equal(extractM3PullRequestPaths(decoy).includes('tests/private-fake.test.mjs'), false)
  const duplicate = workflow.replace('  workflow_dispatch:',
    '      - "' + WORKFLOW_PATH + '"\n  workflow_dispatch:')
  assert.throws(() => extractM3PullRequestPaths(duplicate), /refused/u)
  const missing = workflow.replace('  pull_request:', '  unrelated-event:')
  assert.throws(() => extractM3PullRequestPaths(missing), /refused/u)
})

test('offline operator mode displays sorted paths, strict require-closure exits nonzero, no private evidence', async () => {
  const originalExit = process.exitCode
  try {
    let message = ''
    const before = await main([], str => { message += str })
    assert.equal(before.missingPathCount, staticAudit().missingPathCount)
    assert.equal(JSON.parse(message).candidatePathCount, inventory.length)
    assert.equal(JSON.parse(message).productionReady, false)
    assert.equal(message.includes('participantKey'), false)
    assert.equal(message.includes('observedProduct'), false)
    message = ''
    const forced = await main(['--require-closure'], str => { message += str })
    assert.equal(forced.pathCoverageComplete, false)
    assert.equal(process.exitCode, 2)
    assert.equal(JSON.parse(message).m3ExitProven, false)
    for (const hostile of [
      new Proxy([], { get() { throw Error('PROXY TRAP') } }),
      ['--require-closure', '--malicious'],
      Object.assign([], { weird: 'extra' }),
      Object.assign(['--require-closure'], { unexpected: true }),
    ]) {
      await assert.rejects(main(hostile, () => {
        throw new Error('should not write')
      }), /Independent M3 permanent trigger inventory refused/u)
    }
  } finally {
    process.exitCode = originalExit
  }
})
