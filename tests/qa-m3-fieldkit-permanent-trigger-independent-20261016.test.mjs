import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

// Supa M3 QA-only diagnostic for existing #2833. This reads the *actual*
// workflow on the checked-out SHA. It NEVER dispatches a VPS job, accesses a
// retailer, writes any field evidence or changes the CI owner's workflow.
const workflowPath = '.github/workflows/m3-observed-week-report.yml'
const workflow = readFileSync(resolve(workflowPath), 'utf8')

function selectedPaths(source = workflow) {
  const block = /^  pull_request:\s*\n([\s\S]*?)(?=^  workflow_dispatch:|^concurrency:|^permissions:)/m.exec(source)?.[1]
  assert.ok(block, 'M3 workflow needs an explicit pull_request path admission list')
  const patterns = [...block.matchAll(/^\s+-\s+["']([^"']+)["']\s*$/gm)]
    .map(match => match[1])
  assert.ok(patterns.length >= 10, 'M3 admission list was unexpectedly removed or broadened')
  return patterns
}

function globMatches(pattern, path) {
  let expression = '^'
  for (let i = 0; i < pattern.length;) {
    if (pattern.slice(i, i + 2) === '**') {
      expression += '.*'
      i += 2
    } else if (pattern[i] === '*') {
      expression += '[^/]*'
      i++
    } else {
      expression += pattern[i].replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
      i++
    }
  }
  return new RegExp(expression + '$').test(path)
}

function admitted(path, source = workflow) {
  return selectedPaths(source).some(pattern => globMatches(pattern, path))
}

// All four paths were independently confirmed absent from the real 2026-10-16
// main workflow selector. The first three belong to the M3 human field-kit
// product #2827; the fourth is this exact QA acceptance contract.
const REQUIRED = [
  'scripts/m3-prepare-field-kit.mjs',
  'tests/product-m3-private-field-kit-20261015.test.mjs',
  'docs/product/m3-one-command-human-field-kit.md',
  'tests/qa-m3-fieldkit-permanent-trigger-independent-20261016.test.mjs',
]

for (const file of REQUIRED) {
  test('permanent trusted M3 runner must retrigger when ' + file + ' changes [EXPECTED RED]', () => {
    assert.equal(admitted(file), true,
      file + ': hosted general CI is not permanent vps-bb300bba M3 acceptance')
  })
}

test('M3 runner admission remains narrowly scoped rather than a blanket PR trigger', () => {
  assert.equal(admitted('README.md'), false)
  assert.equal(admitted('src/features/planner/new-unrelated-screen.tsx'), false)
  assert.equal(admitted('scripts/unauthorized-retailer-fetch.mjs'), false)
})

test('M3 permanent runner guard preserves same-repo main-only and private field artifact policy', () => {
  assert.match(workflow, /github\.base_ref == 'main'/)
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/)
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /runs-on:\s*self-hosted/)
  assert.match(workflow, /hostname -s\)" = "vps-bb300bba"/)
  assert.match(workflow, /permissions:\s*\n\s*contents: read/)
  assert.match(workflow, /if:\s*github\.event_name == 'workflow_dispatch'\s*\n\s*uses: actions\/upload-artifact@/)
  assert.match(workflow, /timeout-minutes:\s*12/)
})
