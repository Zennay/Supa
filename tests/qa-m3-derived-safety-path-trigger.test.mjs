import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflowUrl = new URL('../.github/workflows/m3-observed-week-report.yml', import.meta.url)
const required = [
  'tests/qa-m3-private-input-error-redaction.test.mjs',
  'tests/qa-m3-output-arg-failclosed.test.mjs',
  'tests/qa-m3-derived-output-private-directories.test.mjs',
  'tests/qa-m3-derived-symlink-parent-guard.test.mjs',
  'tests/qa-m3-derived-safety-path-trigger.test.mjs',
  'tests/qa-m3-private-operator-positive-contracts.test.mjs',
]

function pathsFromYaml(yaml) {
  const block = /^  pull_request:\s*\n {4}paths:\s*\n((?: {6}- [^\n]+\n)+)/mu.exec(yaml)
  assert.ok(block, 'M3 PR paths must remain explicit')
  return new Set(block[1].trimEnd().split('\n').map((line) => JSON.parse(line.trim().slice(2))))
}

test('M3 permanent workflow selects all live derived privacy tests', async () => {
  const yaml = await readFile(workflowUrl, 'utf8')
  const selected = pathsFromYaml(yaml)
  for (const path of required) assert.ok(selected.has(path), 'missing M3 QA path trigger: ' + path)
  for (const path of [
    'scripts/m3-source-output-preservation.mjs',
    'scripts/m3-assess-observed-week.mjs',
    'scripts/m3-build-observed-study.mjs',
  ]) assert.ok(selected.has(path), 'missing source trigger: ' + path)
})

test('M3 path contract observes omission mutations', async () => {
  const yaml = await readFile(workflowUrl, 'utf8')
  for (const path of required) {
    const needle = '      - "' + path + '"\n'
    const mutant = yaml.replace(needle, '')
    assert.notEqual(mutant, yaml)
    assert.equal(pathsFromYaml(mutant).has(path), false)
  }
})
