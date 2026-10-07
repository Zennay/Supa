import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8',
)

test('hosted CI token is explicitly read-only', () => {
  assert.match(
    workflow,
    /^permissions:\s*\n  contents: read\s*$/m,
    'CI must explicitly limit GITHUB_TOKEN to repository contents read access',
  )
  assert.doesNotMatch(
    workflow,
    /^permissions:\s*write-all\s*$/m,
    'CI must never opt into write-all token permissions',
  )
  assert.doesNotMatch(
    workflow,
    /^\s{2,}[a-z-]+:\s*write\s*$/m,
    'CI must not add a write-scoped GITHUB_TOKEN permission',
  )
})

test('hosted CI cancels superseded runs for the same PR or ref', () => {
  assert.match(
    workflow,
    /^concurrency:\s*\n  group: supa-ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\s*\n  cancel-in-progress: true\s*$/m,
  )
})

test('hosted CI has a bounded execution time', () => {
  assert.match(
    workflow,
    /^\s{4}timeout-minutes:\s*15\s*$/m,
    'hosted CI must fail a hung job within 15 minutes',
  )
})

test('hosted CI keeps the complete quality gate order', () => {
  const requiredSteps = [
    'npm ci',
    'npm test',
    'npm run m1:matching-benchmark',
    'npm run m1:source-permission-gate',
    'npm run build',
  ]

  const positions = requiredSteps.map((step) => {
    const position = workflow.indexOf(`- run: ${step}`)
    assert.notEqual(position, -1, `missing hosted CI step: ${step}`)
    return position
  })

  assert.deepEqual(
    [...positions].sort((left, right) => left - right),
    positions,
    'hosted CI quality gates must keep their current fail-fast order',
  )
})


test('hosted CI pins GitHub-maintained actions to immutable commits', () => {
  const actionUses = [...workflow.matchAll(
    /^\s*- uses:\s*(actions\/[^@\s]+)@([^\s#]+)\s+#\s+(v\d+\.\d+\.\d+)\s*$/gm,
  )]

  assert.equal(actionUses.length, 2, 'CI must keep both GitHub-maintained actions pinned')
  for (const [, action, ref, release] of actionUses) {
    assert.match(ref, /^[0-9a-f]{40}$/i, `${action} must use a full commit SHA`)
    assert.match(release, /^v\d+\.\d+\.\d+$/, `${action} must retain a readable release comment`)
  }

  assert.doesNotMatch(
    workflow,
    /^\s*- uses:\s*actions\/[^@\s]+@v\d+(?:\.\d+){0,2}\s*$/gm,
    'CI must not use mutable actions/* version tags',
  )
})
