import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const workflowDir = '.github/workflows'

const legacyMutableRefs = new Set([
  '.github/workflows/m1-data-capture.yml|actions/checkout@v4',
  '.github/workflows/m1-data-capture.yml|actions/setup-node@v4',
  '.github/workflows/m1-data-capture.yml|actions/upload-artifact@v4',
  '.github/workflows/m3-observed-week-report.yml|actions/checkout@v4',
  '.github/workflows/m3-observed-week-report.yml|actions/setup-node@v4',
  '.github/workflows/m3-observed-week-report.yml|actions/upload-artifact@v4',
])

function isImmutableCommitRef(ref) {
  return /^[0-9a-f]{40}$/i.test(ref)
}

test('workflows cannot introduce new mutable action references', async () => {
  const workflowNames = (await readdir(workflowDir))
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort()

  assert.ok(workflowNames.length > 0, 'expected at least one workflow to inspect')

  const unexpectedMutableRefs = []

  for (const name of workflowNames) {
    const path = join(workflowDir, name)
    const workflow = await readFile(path, 'utf8')

    for (const match of workflow.matchAll(/^\s*(?:-\s*)?uses:\s*([^@\s#]+)@([^\s#]+).*$/gm)) {
      const [, action, ref] = match
      if (isImmutableCommitRef(ref)) continue

      const key = `${path}|${action}@${ref}`
      if (!legacyMutableRefs.has(key)) unexpectedMutableRefs.push(key)
    }
  }

  assert.deepEqual(
    unexpectedMutableRefs,
    [],
    [
      'new mutable GitHub Actions references are forbidden;',
      'pin the action to a full 40-character commit SHA instead',
      'or, for the two existing owner-controlled M1/M3 refs, land the pin in their active workflow PR',
    ].join(' '),
  )
})
