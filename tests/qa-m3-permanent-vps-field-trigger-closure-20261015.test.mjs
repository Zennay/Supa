import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Independent M3 QA: do not edit the permanent runner workflow owned by
// another contributor. This intentionally fails on main until paths are fixed.
const workflowPath = '.github/workflows/m3-observed-week-report.yml'
const required = Object.freeze({
  fieldKit: [
    'scripts/m3-prepare-field-kit.mjs',
    'tests/product-m3-private-field-kit-20261015.test.mjs',
  ],
  privateWeek: [
    'scripts/m3-verify-private-week-preflight.mjs',
    'scripts/m3-private-field-readiness.mjs',
    'tests/product-m3-private-field-readiness-20261015.test.mjs',
    'tests/qa-m3-visible-context-unicode-matrix-20261015.test.mjs',
  ],
})

function selectorPaths(workflow) {
  const block = /^  pull_request:\s*\n    paths:\s*\n((?:      - .*\n)+)/m.exec(workflow)
  assert.ok(block, 'M3 permanent VPS workflow needs explicit pull_request paths')
  return block[1].trimEnd().split('\n').map(line => {
    const match = /^      - "([^"]+)"$/.exec(line)
    assert.ok(match, 'M3 PR path selectors must be quoted literal globs')
    return match[1]
  })
}

function matches(pattern, pathname) {
  const escape = part => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
  const body = pattern.split('**').map(part =>
    part.split('*').map(escape).join('[^/]*'),
  ).join('.*')
  return new RegExp('^' + body + '$').test(pathname)
}

function uncovered(paths, filenames) {
  return filenames.filter(file => !paths.some(pattern => matches(pattern, file)))
}

test('M3 permanent VPS PR paths cover real human field kit and follow-on pinned private QA', () => {
  const paths = selectorPaths(readFileSync(workflowPath, 'utf8'))
  const missingByArea = Object.fromEntries(
    Object.entries(required).map(([area, filenames]) => [
      area, uncovered(paths, filenames),
    ]),
  )
  // Report all absent path families at once, not merely the first failing
  // family. This makes the peer owner's single correction reviewable.
  assert.deepEqual(missingByArea, { fieldKit: [], privateWeek: [] },
    'every M3 private field/source/QA edit must trigger the permanent VPS gate')
})

test('M3 trigger guard still restricts VPS work to main-targeting same-repo PRs', () => {
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /github\.base_ref == 'main'/)
  assert.match(workflow,
    /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /runs-on:\s*self-hosted/)
  assert.match(workflow, /test "\$\(hostname -s\)" = "vps-bb300bba"/)
  assert.match(workflow, /timeout-minutes:\s*12/)
  assert.match(workflow, /permissions:\s*\n  contents: read/)
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch'/)
})

test('mutant path loss is observable for each required field/QA family', () => {
  // Positive fixture makes sure this test cannot silently pass by only
  // asserting that the current unpatched workflow is broken.
  const original = selectorPaths(readFileSync(workflowPath, 'utf8'))
  for (const [area, files] of Object.entries(required)) {
    const fixture = [...original, ...files]
    assert.deepEqual(uncovered(fixture, files), [], area + ' control')
    for (const file of files) {
      const mutant = fixture.filter(selector => selector !== file)
      // If an existing glob already covers this path, remove that too so
      // the test genuinely detects the family losing trigger coverage.
      const noCover = mutant.filter(selector => !matches(selector, file))
      assert.deepEqual(uncovered(noCover, [file]), [file], file)
    }
  }
})
