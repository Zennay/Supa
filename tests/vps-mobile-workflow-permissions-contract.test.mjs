import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync(
  new URL('../.github/workflows/vps-mobile-foundation.yml', import.meta.url),
  'utf8',
)

test('permanent VPS mobile workflow uses an explicit read-only token', () => {
  assert.match(
    workflow,
    /^permissions:\s*\n  contents: read\s*$/m,
    'self-hosted VPS workflow must explicitly limit GITHUB_TOKEN to contents read',
  )
  assert.doesNotMatch(workflow, /^permissions:\s*write-all\s*$/m)
  assert.doesNotMatch(workflow, /^\s{2,}[a-z-]+:\s*write\s*$/m)
})

test('permanent VPS checkout does not persist credentials', () => {
  assert.match(
    workflow,
    /uses: actions\/checkout@[0-9a-f]{40}\s+#\s+v\d+\.\d+\.\d+\s*\n\s*with:\s*\n\s*persist-credentials: false/,
  )
})

test('permanent VPS mobile safety and quality gates remain intact', () => {
  for (const marker of [
    'runs-on: self-hosted',
    'timeout-minutes: 15',
    'test "$(hostname -s)" = "vps-bb300bba"',
    '- run: npm ci',
    '- run: npm test',
    '- run: npm run build',
    'cancel-in-progress: true',
  ]) {
    assert.ok(workflow.includes(marker), `missing VPS mobile contract: ${marker}`)
  }
})


test('permanent VPS workflow pins GitHub-maintained actions to immutable commits', () => {
  const actionUses = [...workflow.matchAll(
    /^\s*- uses:\s*(actions\/[^@\s]+)@([^\s#]+)\s+#\s+(v\d+\.\d+\.\d+)\s*$/gm,
  )]

  assert.equal(actionUses.length, 2)
  for (const [, action, ref, release] of actionUses) {
    assert.match(ref, /^[0-9a-f]{40}$/i, `${action} must use a full commit SHA`)
    assert.match(release, /^v\d+\.\d+\.\d+$/)
  }
  assert.doesNotMatch(workflow, /^\s*- uses:\s*actions\/[^@\s]+@v\d+(?:\.\d+){0,2}\s*$/gm)
})
