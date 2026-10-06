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
