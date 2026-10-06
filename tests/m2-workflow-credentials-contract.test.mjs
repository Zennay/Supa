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
    /uses: actions\/checkout@v4\s*\n\s*with:\s*\n\s*persist-credentials: false/,
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
    'npm run m2:browser-e2e',
    'cancel-in-progress: true',
  ]) {
    assert.ok(workflow.includes(marker), `missing M2 workflow contract: ${marker}`)
  }
})
