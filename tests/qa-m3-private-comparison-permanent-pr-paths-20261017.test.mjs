import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// QA-only, expected-RED on unmodified main. The workflow source owner must
// add appropriate M3 paths. Never edit the runner, YAML or permissions here.
const WORKFLOW = fileURLToPath(new URL('../.github/workflows/m3-observed-week-report.yml', import.meta.url))
const source = readFileSync(WORKFLOW, 'utf8')
const targets = [
  'scripts/m3-private-comparison-csv.mjs',
  'scripts/m3-private-comparison-html.mjs',
  'scripts/m3-private-product-comparison.mjs',
  'tests/qa-m3-all-line-unavailable-fullbasket-privacy-20261017.test.mjs',
  'tests/qa-m3-available-invalid-pack-fullbasket-gate-20261017.test.mjs',
  'tests/qa-m3-multi-missing-paired-22slot-private-export-20261017.test.mjs',
]
function selectors(workflow) {
  // DO NOT look for quoted paths elsewhere: jobs/commands, comments and
  // workflow_dispatch cannot substitute for GitHub pull_request admission.
  const block = /^  pull_request:\s*\n([\s\S]*?)(?=^  workflow_dispatch:|^concurrency:|^permissions:)/m.exec(workflow)?.[1]
  assert.ok(block, 'M3 self-hosted workflow requires PR path controls')
  const pathBlock = /^\s+paths:\s*\n((?:\s+-\s+.*\n)+)/m.exec(block)?.[1]
  assert.ok(pathBlock, 'M3 self-hosted workflow must have actual PR path selectors')
  return [...pathBlock.matchAll(/^\s+-\s+["']([^"']+)["']\s*$/gm)].map(match => match[1])
}
function pathPattern(pattern) {
  // Repo-path GitHub glob matching sufficient for literal, *, ** and ?
  // selectors; does not accidentally treat the slash as a literal in "**".
  const escaped = pattern.replace(/[\\^$+?.()|[\]{}]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\\\?/g, '[^/]')
  return new RegExp('^' + escaped + '$')
}
function covered(path, workflow = source) {
  return selectors(workflow).some(pattern => pathPattern(pattern).test(path))
}

test('positive: mandatory existing M3 main controls and source selectors are scoped to the true PR paths', () => {
  for (const path of [
    '.github/workflows/m3-observed-week-report.yml',
    'scripts/m3-build-observed-study.mjs',
    'src/domain/m3ObservationSheet.ts',
    'tests/m3-workflow-contract.test.mjs',
  ]) assert.equal(covered(path), true, 'pre-existing critical M3 selector lost: ' + path)
  assert.match(source, /github\.base_ref == 'main'/)
  assert.match(source, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
  assert.match(source, /github\.ref == 'refs\/heads\/main'/)
  assert.match(source, /runs-on:\s+self-hosted/)
  assert.match(source, /vps-bb300bba/)
})
test('positive: independent parser supports narrow wildcard or exact owner edits but rejects wrong blocks', () => {
  const path = targets[0]
  assert.equal(pathPattern('scripts/m3-private-*.mjs').test(path), true)
  assert.equal(pathPattern('scripts/m3-other-*.mjs').test(path), false)
  const amended = source.replace(
    '  workflow_dispatch:',
    '      - "' + path + '"\n  workflow_dispatch:',
  )
  assert.equal(covered(path, amended), true, 'legitimate exact selector must pass owner patch')
  const disguised = source.replace(
    '  workflow_dispatch:',
    '  # field gate path ' + path + '\n  workflow_dispatch:',
  )
  assert.equal(covered(path, disguised), false, 'a comment cannot substitute for PR admission')
  assert.equal(covered('scripts/other/not-an-m3-comparison.mjs'), false)
})
for (const path of targets) {
  test('M3 permanent runner must retrigger for private QA/source change: ' + path, () => {
    assert.equal(covered(path), true,
      'an M3 private comparison source or merged QA test bypasses the permanent self-hosted PR gate: ' + path)
  })
}
