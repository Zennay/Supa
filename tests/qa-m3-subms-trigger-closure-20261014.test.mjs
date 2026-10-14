import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workflowPath = '.github/workflows/m3-observed-week-report.yml'
const patterns = [
  'tests/qa-m3-submillisecond-*.test.mjs',
  'tests/qa-m3-subms-*.test.mjs',
]
const newQAFiles = [
  'tests/qa-m3-submillisecond-24h-current-main-20261014.test.mjs',
  'tests/qa-m3-subms-canonical-converter-20261014.test.mjs',
  'tests/qa-m3-subms-collector-export-20261014.test.mjs',
  'tests/qa-m3-subms-two-stage-cli-20261014.test.mjs',
]

// Inspect *only* the actual PR path selector. A workflow comment or script
// mentioning a test pattern does not mean the self-hosted gate will start.
function pullRequestPaths(workflow) {
  const section = /^  pull_request:\s*\n    paths:\s*\n((?:      - .*\n)+)/m.exec(workflow)
  assert.ok(section, 'permanent M3 gate must retain an explicit pull_request path block')
  return section[1].split('\n').filter(Boolean).map((line) => {
    const match = /^      - "([^"]+)"$/.exec(line)
    assert.ok(match, 'selector must be an exact quoted string')
    return match[1]
  })
}

function globMatches(glob, filename) {
  const escaped = glob.replace(/[.*+?^\\$()|[\]{}]/g, '\\$&')
  const regex = '^' + escaped.replace(/\\\*/g, '.*') + '$'
  return new RegExp(regex).test(filename)
}

test('new QA submillisecond checks themselves trigger permanent M3 VPS validation', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const selectors = pullRequestPaths(workflow)
  for (const pattern of patterns) {
    assert.equal(selectors.includes(pattern), true, pattern)
  }
  for (const path of newQAFiles) {
    assert.equal(selectors.some((glob) => globMatches(glob, path)), true,
      'new QA test must not be an untracked gap: ' + path)
  }
})

test('either missing submillisecond path family fails the real trigger contract', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  for (const pattern of patterns) {
    const mutated = workflow.replace('      - "' + pattern + '"\n', '')
    assert.notEqual(mutated, workflow, 'missing synthetic mutation target: ' + pattern)
    assert.equal(pullRequestPaths(mutated).includes(pattern), false,
      'workflow mutation must demonstrably lose direct PR test coverage')
    const affected = newQAFiles.filter((path) => globMatches(pattern, path))
    assert.ok(affected.length > 0)
    for (const path of affected) {
      assert.equal(pullRequestPaths(mutated).some((glob) => globMatches(glob, path)), false,
        'no shadow selector may hide missing submillisecond trigger: ' + path)
    }
  }
})

test('new QA VPS trigger does not broaden repo-trust or publish private M3 inputs', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /runs-on:\s*self-hosted/)
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
  assert.match(workflow, /test "\$\(hostname -s\)" = "vps-bb300bba"/)
  assert.match(workflow, /- run: npm test/)
  assert.match(workflow, /name: Upload M3 field-run pack\n        if: github\.event_name == 'workflow_dispatch'/)
})
