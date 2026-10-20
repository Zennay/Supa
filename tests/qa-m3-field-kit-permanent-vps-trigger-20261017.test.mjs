import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Static independent acceptance for issue #2833. This suite deliberately
// NEVER executes a workflow, retailer HTTP, human observations or VPS code.
const path = '.github/workflows/m3-observed-week-report.yml'
const workflow = readFileSync(path, 'utf8')
const required = [
  'scripts/m3-prepare-field-kit.mjs',
  'docs/product/m3-one-command-human-field-kit.md',
  'tests/product-m3-private-field-kit-20261015.test.mjs',
  'tests/qa-m3-field-kit-permanent-vps-trigger-20261017.test.mjs',
  'scripts/m3-private-pack-unit-price.mjs',
  'tests/qa-m3-unit-guidance-independent-cent-oracle-20261017.test.mjs',
  'tests/qa-m3-private-html-untrusted-text-matrix-20261017.test.mjs',
  'scripts/qa-m3-private-comparison-csv-audit.mjs',
  'tests/qa-m3-private-csv-stdin-safety-audit-20261017.test.mjs',
  'tests/qa-m3-private-csv-numeric-column-safety-20261017.test.mjs',
]

function prPathFilters(yaml) {
  const block = /^  pull_request:\s*\n    paths:\s*\n((?:      - [^\n]+\n)+)/m.exec(yaml)?.[1]
  assert.ok(block, 'permanent M3 PR filter must be explicit')
  const values = block.split(/\r?\n/).filter(Boolean).map(line => {
    assert.ok(/^      - "(?:[^"]+)"$/.test(line), 'quoted, exact filter required')
    return JSON.parse(line.trim().slice(2))
  })
  assert.equal(values.length, new Set(values).size, 'no duplicate PR filters')
  return values
}

function requireCriticalPaths(paths) {
  for (const requiredPath of required) {
    assert.ok(paths.includes(requiredPath),
      'self-hosted M3 runner misses field-kit trigger: ' + requiredPath)
  }
}

test('M3: self-hosted trigger keeps same-repository/main and manual-main execution limits', () => {
  assert.match(workflow, /github\.base_ref == 'main'/)
  assert.match(workflow,
    /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
  assert.match(workflow,
    /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /runs-on: self-hosted/)
  assert.match(workflow, /test "\$\(hostname -s\)" = "vps-bb300bba"/)
  assert.match(workflow,
    /if: github\.event_name == 'workflow_dispatch'\s*\n\s*uses: actions\/upload-artifact@/)
})

test('M3: path trigger parser reads only the pull_request.paths block', () => {
  const paths = prPathFilters(workflow)
  assert.ok(paths.includes(path))
  assert.ok(!paths.includes('tests/nonexistent-gitignore.test.mjs'))
})

for (const requiredPath of required) {
  test('M3 permanent runner must rerun when field-kit path changes: ' + requiredPath, () => {
    const paths = prPathFilters(workflow)
    assert.ok(paths.includes(requiredPath),
      'missing permanent VPS evidence trigger: ' + requiredPath)
  })
}

test('M3: owner-acceptable narrow patch protects all ten field-kit and merged QA paths from regressions', () => {
  const current = prPathFilters(workflow)
  const patched = [...current, ...required.filter(p => !current.includes(p))]
  requireCriticalPaths(patched)
  assert.equal(patched.length, new Set(patched).size)
  for (const lost of required) {
    const mutant = patched.filter(p => p !== lost)
    assert.throws(() => requireCriticalPaths(mutant),
      /self-hosted M3 runner misses field-kit trigger/)
  }
  assert.deepEqual(prPathFilters(workflow), current,
    'synthetic proposed-owner patch must not alter the real workflow file')
})
