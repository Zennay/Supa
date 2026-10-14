import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'

const workflowDir = '.github/workflows'


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

    for (const match of workflow.matchAll(/^\s*(?:-\s*)?uses:\s*['"]?([^@\s#'"]+)@([^\s#'"]+)['"]?.*$/gm)) {
      const [, action, ref] = match
      if (isImmutableCommitRef(ref)) continue

      const key = `${path}|${action}@${ref}`
      unexpectedMutableRefs.push(key)
    }
  }

  assert.deepEqual(
    unexpectedMutableRefs,
    [],
    [
      'new mutable GitHub Actions references are forbidden;',
      'pin the action to a full 40-character commit SHA instead',
    ].join(' '),
  )
})

test('mutable action references cannot hide behind quoted YAML uses values', () => {
  const fixture = [
    '    - uses: "actions/checkout@v4" # legacy mutable',
    "    - uses: 'actions/setup-node@main'",
    '    - uses: actions/cache@v4',
    '    - uses: "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02" # pinned',
  ].join('\\n')
  const found = [...fixture.matchAll(/^\\s*(?:-\\s*)?uses:\\s*['"]?([^@\\s#'"]+)@([^\\s#'"]+)['"]?.*$/gm)]
    .filter(([, , ref]) => !isImmutableCommitRef(ref))
    .map(([, action, ref]) => action + '@' + ref)
  assert.deepEqual(found, ['actions/checkout@v4', 'actions/setup-node@main', 'actions/cache@v4'])
})
