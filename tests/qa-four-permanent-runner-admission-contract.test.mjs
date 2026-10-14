import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sameRepo = 'github.event.pull_request.head.repo.full_name == github.repository'
const guardedPullRequest =
  "github.event_name != 'pull_request' || " + sameRepo
const manualOrTrustedMain =
  "github.event_name == 'workflow_dispatch' || (github.event_name == 'pull_request' && github.base_ref == 'main' && " + sameRepo + ')'

const workflows = [
  ['m1-data-capture.yml', manualOrTrustedMain, true],
  ['m2-vps-e2e.yml', guardedPullRequest, true],
  ['m3-observed-week-report.yml', manualOrTrustedMain, true],
  ['vps-mobile-foundation.yml', guardedPullRequest, false],
]

function assertPermanentRunnerAdmission(workflow, expectedCondition, manual) {
  assert.match(workflow, /^on:\n  pull_request:\s*$/m)
  assert.doesNotMatch(workflow, /^\s+pull_request_target:\s*$/m)
  assert.equal((workflow.match(/^    runs-on: self-hosted\s*$/gm) ?? []).length, 1)

  // The guard must be at the JOB level, immediately before the allocation.
  // A guard that merely occurs in a shell step would be too late.
  const guardedJobs = [
    ...workflow.matchAll(/^  [\w-]+:\n    if: ([^\n]+)\n    runs-on: self-hosted\s*$/gm),
  ]
  assert.equal(guardedJobs.length, 1, 'one protected job required')
  assert.equal(guardedJobs[0][1], expectedCondition, 'fork PRs must be refused before runner allocation')
  assert.match(workflow, /^permissions:\s*\n  contents: read\s*$/m)
  assert.match(workflow, /uses: actions\/checkout@[^\n]+\n\s+with:\n\s+persist-credentials: false/)
  assert.match(workflow, /test "\$\(hostname -s\)" = "vps-bb300bba"/)
  assert.match(workflow, /^\s+cancel-in-progress: true\s*$/m)
  assert.equal(/^  workflow_dispatch:\s*$/m.test(workflow), manual)
}

for (const [file, condition, manual] of workflows) {
  const path = new URL('../.github/workflows/' + file, import.meta.url)

  test('QA permanent runner admits only authorized PRs: ' + file, async () => {
    const workflow = await readFile(path, 'utf8')
    assertPermanentRunnerAdmission(workflow, condition, manual)
  })

  test('QA mutation proof: fork bypass and step-only guard are rejected: ' + file, async () => {
    const workflow = await readFile(path, 'utf8')
    assert.ok(workflow.includes('if: ' + condition))

    const bypass = workflow.replace('if: ' + condition, 'if: github.event_name == \'pull_request\'')
    assert.throws(() => assertPermanentRunnerAdmission(bypass, condition, manual))

    const late = workflow.replace(
      '    if: ' + condition + '\n    runs-on: self-hosted',
      '    runs-on: self-hosted\n    steps:\n      - name: Misplaced guard\n        if: ' + condition,
    )
    assert.throws(() => assertPermanentRunnerAdmission(late, condition, manual))

    const persisted = workflow.replace('persist-credentials: false', 'persist-credentials: true')
    assert.throws(() => assertPermanentRunnerAdmission(persisted, condition, manual))
  })
}
