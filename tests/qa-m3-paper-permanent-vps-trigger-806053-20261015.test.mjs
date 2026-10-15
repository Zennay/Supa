import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Independent QA gate for newly merged 3-state paper AND multipack workflow.
// Do NOT change the shared permanent VPS workflow owned by another worker.
const workflowPath = '.github/workflows/m3-observed-week-report.yml'
const required = [
  'scripts/m3-print-field-checklist.mjs',
  'tests/product-m3-print-field-checklist.test.mjs',
  'tests/product-m3-paper-three-state-20261015.test.mjs',
  'tests/product-m3-paper-private-output-parents-20261015.test.mjs',
  'tests/qa-m3-paper-observation-three-state-contract-20261015.test.mjs',
  'tests/qa-m3-paper-private-output-parent-integrity-20261015.test.mjs',
  'tests/qa-m3-paper-output-no-directory-side-effects-20261015.test.mjs',
  'tests/product-m3-paper-multipack-clarity-20261015.test.mjs',
  'tests/qa-m3-paper-multipack-pricing-contract-20261015.test.mjs',
  'tests/product-m3-paper-required-metadata-20261015.test.mjs',
  'tests/qa-m3-paper-required-metadata-readiness-20261015.test.mjs',
  'tests/qa-m3-paper-fullbasket-private-report-matrix-20261015.test.mjs',
  'tests/product-m3-paper-print-pagination-20261015.test.mjs',
]
function paths(workflow) {
  const block = /^  pull_request:\s*\n    paths:\s*\n((?:      - .*\n)+)/m.exec(workflow)
  assert.ok(block, 'permanent M3 job needs an explicit PR path selector')
  return block[1].trimEnd().split('\n').map(line => {
    const match = /^      - "([^"]+)"$/.exec(line)
    assert.ok(match, 'PR selector must be a quoted exact string/glob')
    return match[1]
  })
}
function globMatches(glob, path) {
  const special = s => s.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
  const pattern = glob.split('**').map(x => x.split('*').map(special).join('[^/]*')).join('.*')
  return new RegExp('^' + pattern + '$').test(path)
}
function missing(selectors, files) {
  return files.filter(file => !selectors.some(pattern => globMatches(pattern, file)))
}

test('current M3 paper, metadata, pagination, fullbasket and independent QA paths must trigger the permanent trusted VPS', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  const absent = missing(paths(workflow), required)
  assert.deepEqual(absent, [],
    'the permanent M3 PR gate misses paper, required metadata or QA paths on current merged main')
})

test('M3 permanent VPS path correction must preserve same-repo/main/private execution guards', () => {
  const w = readFileSync(workflowPath, 'utf8')
  assert.match(w, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
  assert.match(w, /github\.base_ref == 'main'/)
  assert.match(w, /github\.ref == 'refs\/heads\/main'/)
  assert.match(w, /runs-on:\s*self-hosted/)
  assert.match(w, /test "\$\(hostname -s\)" = "vps-bb300bba"/)
  assert.match(w, /timeout-minutes:\s*12/)
  assert.match(w, /permissions:\s*\n  contents: read/)
  assert.match(w, /if: github\.event_name == 'workflow_dispatch'/)
  assert.match(w, /if-no-files-found: error/)
})

test('removing any paper or multipack path from a complete synthetic selector set is detected', () => {
  const baseline = paths(readFileSync(workflowPath, 'utf8'))
  const control = [...baseline, ...required]
  assert.deepEqual(missing(control, required), [])
  for (const file of required) {
    const mutation = control.filter(pattern => !globMatches(pattern, file))
    assert.deepEqual(missing(mutation, [file]), [file], file)
  }
})
