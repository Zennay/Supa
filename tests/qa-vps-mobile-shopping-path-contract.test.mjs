import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Synthetic contract for the permanent, self-hosted mobile check. This test
// never executes a browser, fetches store data or schedules a workflow.
const workflowPath = new URL('../.github/workflows/vps-mobile-foundation.yml', import.meta.url)
const required = [
  'tests/qa-shopping-open-filter-persisted-print-copy-20261014.test.mjs',
  'tests/product-shopping-open-only-filter-20261014.test.mjs',
  'tests/qa-copy-blank-filler-export-ssr-20261014.test.mjs',
  'tests/qa-vps-mobile-shopping-path-contract.test.mjs',
]

function selectedPaths(workflow) {
  const block = /^  pull_request:\s*\n    paths:\s*\n((?:      - [^\n]+\n)+)/mu.exec(workflow)
  assert.ok(block, 'permanent mobile gate requires explicit PR paths')
  return new Set(block[1].split('\n').filter(Boolean).map((line) =>
    JSON.parse(line.trim().slice(2)),
  ))
}

function assertMobileGuard(workflow) {
  const paths = selectedPaths(workflow)
  for (const entry of required) {
    assert.ok(paths.has(entry), 'shopping QA changes must trigger VPS mobile: ' + entry)
  }
  assert.ok(paths.has('src/features/**'), 'live product changes must trigger mobile checks')
  assert.ok(paths.has('.github/workflows/vps-mobile-foundation.yml'))
  assert.match(workflow, /^    if: github\.event_name != 'pull_request' \|\| github\.event\.pull_request\.head\.repo\.full_name == github\.repository$/mu)
  assert.match(workflow, /^    runs-on: self-hosted$/mu)
  assert.match(workflow, /test "\$\(hostname -s\)" = "vps-bb300bba"/u)
  assert.match(workflow, /^      - run: npm test$/mu)
  assert.match(workflow, /^      - run: npm run build$/mu)
}

test('mobile self-hosted workflow triggers on actual shopping UI tests', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  assertMobileGuard(workflow)
})

test('mobile shopping gate omission and runner trust bypass mutations fail closed', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  for (const path of required) {
    const needle = '      - "' + path + '"\n'
    const mutant = workflow.replace(needle, '')
    assert.notEqual(mutant, workflow, 'missing real trigger fixture: ' + path)
    assert.throws(() => assertMobileGuard(mutant),
      /shopping QA changes must trigger VPS mobile/u)
  }
  for (const [target, replacement] of [
    ["github.event.pull_request.head.repo.full_name == github.repository", 'true'],
    ['    runs-on: self-hosted', '    runs-on: ubuntu-latest'],
    ['test "$(hostname -s)" = "vps-bb300bba"', 'echo no-runner-check'],
    ['      - run: npm test', '      - run: echo skip-tests'],
    ['      - run: npm run build', '      - run: echo skip-build'],
  ]) {
    const mutant = workflow.replace(target, replacement)
    assert.notEqual(mutant, workflow)
    assert.throws(() => assertMobileGuard(mutant))
  }
})
