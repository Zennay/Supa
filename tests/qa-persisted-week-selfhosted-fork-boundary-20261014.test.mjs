import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Existing security issue #365: a public fork PR must never run arbitrary
// checkout/npm ci/build/browser code on permanent self-hosted vps-bb300bba.
// Scope is the newly added product-week workflow only. Do not alter #523's
// independently owned M2/mobile acceptance suites or the product-core workflow.
const workflowFile = new URL('../.github/workflows/product-persisted-week-vps.yml', import.meta.url)
const guard = "if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository"

function jobHasSafeAdmission(workflow) {
  // Require the trust check at JOB level BEFORE assigning the persistent
  // runner. A step-level check occurs too late: runner already allocated.
  return new RegExp(
    '^  rendered-persisted-week:\\n' +
      '(?:    #[^\\n]*\\n)*' +
      '    ' + guard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '\\n    runs-on: self-hosted\\s*$',
    'm',
  ).test(workflow)
}

test('positive: hypothetical good job-level same-repository admission passes only before runner assignment', () => {
  const trusted = [
    'name: synthetic standalone test',
    'on:',
    '  pull_request:',
    '  workflow_dispatch:',
    'permissions:',
    '  contents: read',
    'jobs:',
    '  rendered-persisted-week:',
    '    ' + guard,
    '    runs-on: self-hosted',
  ].join('\n')
  const missing = trusted.replace('    ' + guard + '\n', '')
  const tooLate = trusted.replace(
    '    ' + guard + '\n    runs-on: self-hosted',
    '    runs-on: self-hosted\n    steps:\n      - ' + guard,
  )
  assert.equal(jobHasSafeAdmission(trusted), true)
  // Comments may document the security condition; this must not falsely RED
  // the corrected owner workflow, provided the IF remains job-level.
  const documented = trusted.replace(
    '  rendered-persisted-week:\n    ' + guard,
    '  rendered-persisted-week:\n' +
      '    # independent admission context\n' +
      '    # reject fork heads before runner allocation\n' +
      '    ' + guard,
  )
  assert.equal(jobHasSafeAdmission(documented), true)
  assert.equal(jobHasSafeAdmission(missing), false,
    'read-only token permissions alone do not isolate persistent runner')
  assert.equal(jobHasSafeAdmission(tooLate), false,
    'step guard after a runner allocation is too late')
})

test('positive: current workflow retains manual validation and read-only checkout boundaries', async () => {
  const workflow = await readFile(workflowFile, 'utf8')
  assert.match(workflow, /^on:\s*$/m)
  assert.match(workflow, /^  pull_request:\s*$/m)
  assert.match(workflow, /^  workflow_dispatch:\s*$/m)
  assert.doesNotMatch(workflow, /^  pull_request_target:\s*$/m)
  assert.match(workflow, /^permissions:\s*\n  contents: read\s*$/m)
  assert.match(workflow, /uses:\s*actions\/checkout@[^\n]+\n\s+with:\n\s+persist-credentials:\s*false/m)
  assert.match(workflow, /test "\$\(hostname -s\)" = "vps-bb300bba"/)
  assert.match(workflow, /PRODUCT_WEEK_BASE_URL="http:\/\/127\.0\.0\.1:/)
  assert.match(workflow, /PRODUCT_WEEK_WEBDRIVER_URL="http:\/\/127\.0\.0\.1:/)
  assert.match(workflow, /timeout-minutes:\s*15/)
})

test('expected RED #365: PR fork code cannot allocate the permanent product-week self-hosted job', async () => {
  const workflow = await readFile(workflowFile, 'utf8')
  const persistentRunnerJobs = workflow.match(/^\s+runs-on:\s*self-hosted\s*$/gm) ?? []
  assert.equal(persistentRunnerJobs.length, 1,
    'future additional permanent jobs must have their own admission review')
  assert.equal(jobHasSafeAdmission(workflow), true,
    'self-hosted PR job MUST require head.repo.full_name == github.repository before runs-on')
})
