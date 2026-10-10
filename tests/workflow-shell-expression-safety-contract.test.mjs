import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowsDir = new URL('../.github/workflows/', import.meta.url)

const untrustedExpressions = [
  /\$\{\{\s*github\.event\.pull_request\.title\b/,
  /\$\{\{\s*github\.event\.pull_request\.body\b/,
  /\$\{\{\s*github\.event\.pull_request\.head\.ref\b/,
  /\$\{\{\s*github\.head_ref\b/,
]

function shellRunBodies(source) {
  const lines = source.split(/\r?\n/)
  const bodies = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(line)
    if (!match) continue

    const indent = match[1].length
    const value = match[2].trim()

    if (value !== '|' && value !== '>' && value !== '|-' && value !== '>-') {
      bodies.push(value)
      continue
    }

    const block = []
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next]
      if (candidate.trim() === '') {
        block.push(candidate)
        continue
      }

      const candidateIndent = /^\s*/.exec(candidate)?.[0].length ?? 0
      if (candidateIndent <= indent) break
      block.push(candidate)
      index = next
    }
    bodies.push(block.join('\n'))
  }

  return bodies
}

function unsafeShellExpression(source) {
  for (const body of shellRunBodies(source)) {
    for (const pattern of untrustedExpressions) {
      if (pattern.test(body)) return body
    }
  }
  return null
}

test('workflow shell commands never interpolate untrusted PR expressions', async () => {
  const workflowFiles = (await readdir(workflowsDir))
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()

  assert.ok(workflowFiles.length > 0, 'expected at least one GitHub workflow')

  for (const file of workflowFiles) {
    const source = await readFile(new URL(file, workflowsDir), 'utf8')
    assert.equal(
      unsafeShellExpression(source),
      null,
      file + ' directly interpolates untrusted PR data into a shell command',
    )
  }
})

test('shell-expression guard covers inline and block run commands only', () => {
  for (const source of [
    'steps:\n  - run: echo "${{ github.event.pull_request.title }}"\n',
    'steps:\n  - run: |\n      echo "${{ github.event.pull_request.body }}"\n',
    'steps:\n  - run: >\n      echo "${{ github.head_ref }}"\n',
    'steps:\n  - run: echo "${{ github.event.pull_request.head.ref }}"\n',
  ]) {
    assert.notEqual(unsafeShellExpression(source), null, source)
  }

  for (const source of [
    'concurrency:\n  group: pr-${{ github.head_ref }}\n',
    'name: "${{ github.event.pull_request.title }}"\n',
    'steps:\n  - env:\n      PR_TITLE: ${{ github.event.pull_request.title }}\n    run: echo "$PR_TITLE"\n',
    'steps:\n  - run: npm test\n',
  ]) {
    assert.equal(unsafeShellExpression(source), null, source)
  }
})
