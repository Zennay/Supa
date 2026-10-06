import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowPath = '.github/workflows/m1-data-capture.yml'
const workflow = await readFile(workflowPath, 'utf8')

test('M1 permanent runner rejects fork pull-request heads', () => {
  assert.match(workflow, /runs-on:\s*self-hosted/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(
    workflow,
    /github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/,
  )
  assert.match(
    workflow,
    /if:\s*github\.event_name\s*==\s*'workflow_dispatch'\s*\|\|\s*\(github\.event_name\s*==\s*'pull_request'[^\n]*github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository\)/,
  )
})

test('M1 fork guard keeps the existing permanent-runner evidence contract', () => {
  assert.match(
    workflow,
    /uses:\s*actions\/checkout@v4[\s\S]*?persist-credentials:\s*false/,
  )
  assert.match(workflow, /test "\$\(hostname -s\)" = "vps-bb300bba"/)
  assert.match(workflow, /run:\s*npm ci/)
  assert.match(workflow, /run:\s*npm test/)
  assert.match(workflow, /run:\s*npm run m1:matching-benchmark/)
  assert.match(workflow, /run:\s*node scripts\/m1-capture-sources\.mjs/)
  assert.match(workflow, /uses:\s*actions\/upload-artifact@v4/)
  assert.match(
    workflow,
    /tests\/m1-workflow-fork-safety-contract\.test\.mjs/,
  )
})
