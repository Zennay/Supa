import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowsDir = new URL('../.github/workflows/', import.meta.url)

function declaresPullRequestTarget(source) {
  return /^\s*pull_request_target\s*:/m.test(source)
}

test('GitHub workflows never use pull_request_target', async () => {
  const workflowFiles = (await readdir(workflowsDir))
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()

  assert.ok(workflowFiles.length > 0, 'expected at least one GitHub workflow')

  for (const file of workflowFiles) {
    const source = await readFile(new URL(file, workflowsDir), 'utf8')
    assert.equal(
      declaresPullRequestTarget(source),
      false,
      file + ' must use safer workflow triggers instead of pull_request_target',
    )
  }
})

test('trigger guard distinguishes YAML keys from comments and prose', () => {
  for (const source of [
    'on:\n  pull_request_target:\n',
    'pull_request_target:\n',
    '  pull_request_target: {}\n',
  ]) {
    assert.equal(declaresPullRequestTarget(source), true, source)
  }

  for (const source of [
    'on:\n  pull_request:\n',
    '# pull_request_target:\n',
    'name: "do not use pull_request_target: here"\n',
    'run: echo pull_request_target:\n',
  ]) {
    assert.equal(declaresPullRequestTarget(source), false, source)
  }
})
