import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowPaths = [
  '.github/workflows/vps-mobile-foundation.yml',
  '.github/workflows/m2-vps-e2e.yml',
]

const sameRepositoryGuard =
  "if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository"

function escapeRegExp(value) {
  return value.replace(/[.*+?^$()|[\]{}]/g, '\\$&')
}

for (const workflowPath of workflowPaths) {
  test(`${workflowPath} blocks fork PR code from the permanent self-hosted runner`, async () => {
    const workflow = await readFile(
      new URL(`../${workflowPath}`, import.meta.url),
      'utf8',
    )

    assert.match(workflow, /^\s+pull_request:\s*$/m)
    assert.doesNotMatch(workflow, /^\s+pull_request_target:\s*$/m)

    const selfHostedRuns = workflow.match(/^\s+runs-on:\s*self-hosted\s*$/gm) ?? []
    assert.equal(selfHostedRuns.length, 1, 'workflow must expose exactly one permanent self-hosted job')

    assert.match(
      workflow,
      new RegExp(
        `^  [A-Za-z0-9_-]+:\\n    ${escapeRegExp(sameRepositoryGuard)}\\n    runs-on: self-hosted\\s*$`,
        'm',
      ),
      'same-repository guard must be attached to the self-hosted job before runner allocation',
    )
    assert.match(workflow, /^permissions:\s*\n\s+contents:\s*read\s*$/m)
    assert.match(
      workflow,
      /uses:\s*actions\/checkout@[^\n]+\n\s+with:\n\s+persist-credentials:\s*false/m,
      'self-hosted checkout must not persist GitHub credentials',
    )
  })
}
