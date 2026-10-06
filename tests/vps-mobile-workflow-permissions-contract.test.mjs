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
    /uses: actions\/checkout@v4\s*\n\s*with:\s*\n\s*persist-credentials: false/,
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
