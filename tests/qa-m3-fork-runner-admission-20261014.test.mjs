import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Regression-only evidence for the already-open runner trust issue #365.
// The M3 workflow is owned by #191. This file MUST NOT modify that workflow.
const workflowPath = new URL('../.github/workflows/m3-observed-week-report.yml', import.meta.url)
const exactGuard = "github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository"

function assertPermanentM3RunnerIsForkSafe(workflow) {
  assert.match(workflow, /^on:\s*$/m)
  assert.match(workflow, /^  pull_request:\s*$/m)
  assert.match(workflow, /^  workflow_dispatch:\s*$/m)
  assert.doesNotMatch(workflow, /^  pull_request_target:\s*$/m)

  const jobsStart = workflow.split(/\r?\n/).findIndex((line) => line === 'jobs:')
  assert.ok(jobsStart >= 0, 'workflow must define jobs')
  const lines = workflow.split(/\r?\n/)
  const jobs = []
  let current = null

  for (const line of lines.slice(jobsStart + 1)) {
    // A new YAML root key ends the jobs mapping.
    if (/^\S/.test(line) && !line.startsWith('#')) break
    const heading = /^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(line)
    if (heading) {
      current = { name: heading[1], lines: [] }
      jobs.push(current)
      continue
    }
    if (current) current.lines.push(line)
  }

  const permanentJobs = jobs.filter((job) =>
    job.lines.some((line) => /^    runs-on:\s*self-hosted\s*(?:#.*)?$/.test(line)),
  )
  assert.equal(permanentJobs.length, 1, 'M3 must have exactly one permanent self-hosted job')

  for (const job of permanentJobs) {
    const runnerLine = job.lines.findIndex((line) =>
      /^    runs-on:\s*self-hosted\s*(?:#.*)?$/.test(line))
    const guardLines = job.lines
      .slice(0, runnerLine)
      .filter((line) => /^    if:\s*/.test(line))
    assert.deepEqual(
      guardLines,
      ['    if: ' + exactGuard],
      'only a job-level, exact same-repository guard BEFORE runner allocation is admissible',
    )
    // Other guards at step level, on unrelated jobs or after runs-on are insufficient.
    assert.ok(runnerLine > 0)
  }
}

function syntheticWorkflow({ jobGuard = '', secondJobGuard = '', suffix = '' } = {}) {
  const lines = [
    'name: synthetic M3 admission fixture',
    'on:',
    '  pull_request:',
    '  workflow_dispatch:',
    'jobs:',
    '  unrelated:',
    ...(secondJobGuard ? ['    if: ' + secondJobGuard] : []),
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - run: echo safe',
    '  report-gate:',
    ...(jobGuard ? jobGuard.split('\n') : []),
    '    runs-on: self-hosted',
    '    steps:',
    '      - run: echo synthetic-only',
  ]
  if (suffix) lines.push(...suffix.split('\n'))
  return lines.join('\n') + '\n'
}

test('synthetic same-repository guard allows safe M3 admission contract', () => {
  assert.doesNotThrow(() =>
    assertPermanentM3RunnerIsForkSafe(syntheticWorkflow({ jobGuard: '    if: ' + exactGuard })),
  )
})

test('synthetic documented job guard accepts YAML comments before runner', () => {
  const guarded = '    # protect the permanent runner\n    if: ' + exactGuard +
    '\n    # human field-pack dispatch is allowed'
  assert.doesNotThrow(() => assertPermanentM3RunnerIsForkSafe(
    syntheticWorkflow({ jobGuard: guarded }),
  ))
})

test('synthetic missing guard is rejected', () => {
  assert.throws(() => assertPermanentM3RunnerIsForkSafe(syntheticWorkflow()))
})

test('synthetic step-level guard does not authorize permanent runner allocation', () => {
  assert.throws(() => assertPermanentM3RunnerIsForkSafe(syntheticWorkflow({
    suffix: '      - if: ' + exactGuard,
  })))
})

test('synthetic unrelated-job guard does not authorize M3 runner', () => {
  assert.throws(() => assertPermanentM3RunnerIsForkSafe(syntheticWorkflow({
    secondJobGuard: exactGuard,
  })))
})

test('synthetic guard after runner allocation is rejected', () => {
  assert.throws(() => assertPermanentM3RunnerIsForkSafe(syntheticWorkflow({
    suffix: '    if: ' + exactGuard,
  })))
})

test('synthetic weaker repository-owner check is rejected', () => {
  assert.throws(() => assertPermanentM3RunnerIsForkSafe(syntheticWorkflow({
    jobGuard: '    if: github.event_name != ' + "'pull_request'" +
      ' || github.event.pull_request.head.repo.owner.login == github.repository_owner',
  })))
})

test('synthetic always-true bypass cannot weaken exact admission guard', () => {
  assert.throws(() => assertPermanentM3RunnerIsForkSafe(syntheticWorkflow({
    jobGuard: '    if: ' + exactGuard + ' || true',
  })))
})

test('original M3 #191 workflow refuses fork PRs before allocating vps-bb300bba (#365)', async () => {
  const workflow = await readFile(workflowPath, 'utf8')
  assertPermanentM3RunnerIsForkSafe(workflow)
})
