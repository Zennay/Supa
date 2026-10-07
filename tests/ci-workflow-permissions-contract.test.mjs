import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8',
)

function githubMaintainedActionUses(source) {
  const uses = []

  for (const line of source.split(/\r?\n/)) {
    const declaration = line.match(/^\s*-\s+uses:\s+(.+?)\s*$/)
    if (!declaration) continue

    let raw = declaration[1]
    const releaseMatch = raw.match(/\s+#\s+(v\d+\.\d+\.\d+)\s*$/)
    const release = releaseMatch?.[1] ?? null
    if (releaseMatch) raw = raw.slice(0, releaseMatch.index).trim()

    const quoted = raw.match(/^(['"])(.*)\1$/)
    const actionUse = (quoted ? quoted[2] : raw).match(
      /^(actions\/[^@\s]+)@([^\s#]+)$/,
    )
    if (!actionUse) continue

    uses.push({
      action: actionUse[1],
      ref: actionUse[2],
      release,
    })
  }

  return uses
}

function assertPinnedGithubMaintainedActions(source, expectedCount) {
  const actionUses = githubMaintainedActionUses(source)

  assert.equal(
    actionUses.length,
    expectedCount,
    'CI must keep the expected GitHub-maintained action set pinned',
  )

  for (const { action, ref, release } of actionUses) {
    assert.match(ref, /^[0-9a-f]{40}$/i, `${action} must use a full commit SHA`)
    assert.match(
      release ?? '',
      /^v\d+\.\d+\.\d+$/,
      `${action} must retain a readable release comment`,
    )
  }
}

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

test('hosted CI checkout does not persist credentials', () => {
  assert.match(
    workflow,
    /uses: actions\/checkout@[0-9a-f]{40}\s+#\s+v\d+\.\d+\.\d+\s*\n\s*with:\s*\n\s*persist-credentials: false/,
    'hosted CI checkout must not leave GITHUB_TOKEN credentials in local git config',
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
    'npm audit --audit-level=high',
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
  assertPinnedGithubMaintainedActions(workflow, 2)
})

test('action pinning contract rejects quoted mutable GitHub action refs', () => {
  assert.throws(
    () =>
      assertPinnedGithubMaintainedActions(
        `
        steps:
          - uses: "actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" # v4.2.2
          - uses: 'actions/setup-node@v4' # v4.4.0
          - uses: "owner/custom-action@v1"
        `,
        2,
      ),
    /actions\/setup-node must use a full commit SHA/,
  )
})
