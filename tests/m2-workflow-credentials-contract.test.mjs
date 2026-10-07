import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflow = readFileSync(
  new URL('../.github/workflows/m2-vps-e2e.yml', import.meta.url),
  'utf8',
)

test('M2 browser checkout does not persist credentials', () => {
  assert.match(
    workflow,
    /uses: actions\/checkout@[0-9a-f]{40}\s+#\s+v\d+\.\d+\.\d+\s*\n\s*with:\s*\n\s*persist-credentials: false/,
  )
})

test('M2 browser runner keeps its safety and proof gates', () => {
  for (const marker of [
    'permissions:',
    'contents: read',
    'runs-on: self-hosted',
    'timeout-minutes: 12',
    'test "$(hostname -s)" = "vps-bb300bba"',
    'npm test',
    'npm run build',
    'node tests/m2-browser-e2e.mjs',
    'cancel-in-progress: true',
  ]) {
    assert.ok(workflow.includes(marker), `missing M2 workflow contract: ${marker}`)
  }
})


test('M2 browser workflow pins GitHub-maintained actions to immutable commits', () => {
  const actionUses = [...workflow.matchAll(
    /^\s*(?:-\s*)?uses:\s*(actions\/[^@\s]+)@([^\s#]+)\s+#\s+(v\d+\.\d+\.\d+)\s*$/gm,
  )]

  assert.equal(actionUses.length, 3)
  for (const [, action, ref, release] of actionUses) {
    assert.match(ref, /^[0-9a-f]{40}$/i, `${action} must use a full commit SHA`)
    assert.match(release, /^v\d+\.\d+\.\d+$/)
  }
  assert.doesNotMatch(workflow, /^\s*(?:-\s*)?uses:\s*actions\/[^@\s]+@v\d+(?:\.\d+){0,2}\s*$/gm)
})
