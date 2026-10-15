import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Independent QA of the existing *permanent* trusted M3 runner's trigger
// selection. This module never dispatches a workflow or contacts retailers.
// Paths are prospective PR change names, including owner-only draft additions.
const workflowPath = fileURLToPath(new URL('../.github/workflows/m3-observed-week-report.yml', import.meta.url))
const OWN_QA = 'tests/qa-m3-permanent-gate-path-coverage-20261015.test.mjs'

async function ruleSet() {
  const workflow = await readFile(workflowPath, 'utf8')
  const match = /^  pull_request:\s*\n    paths:\s*\n((?:      - "[^"]+"\s*\n)+)/mu.exec(workflow)
  assert.ok(match, 'trusted M3 PR trigger must have a restricted quoted paths list')
  return { workflow, paths: match[1].split('\n').filter(Boolean).map(line => JSON.parse(line.trim().slice(2))) }
}

function selects(paths, changedFile) {
  return paths.some(pattern => {
    const regex = '^' + pattern.replaceAll('.', '\\.')
      .replaceAll('**', '\u0000').replaceAll('*', '[^/]*')
      .replaceAll('\u0000', '.*') + '$'
    return new RegExp(regex, 'u').test(changedFile)
  })
}

test('positive: permanent M3 runner retains safe PR/dispatch admission and canonical source selection', async () => {
  const { workflow, paths } = await ruleSet()
  assert.match(workflow, /^    runs-on: self-hosted\s*$/mu)
  assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/u)
  assert.match(workflow, /github\.base_ref == 'main'/u)
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/u)
  for (const path of [
    'scripts/m3-create-observation-sheet.mjs',
    'scripts/m3-build-observed-study.mjs',
    'scripts/m3-assess-observed-week.mjs',
  ]) assert.equal(selects(paths, path), true, 'M3 canonical product path omitted: ' + path)
})

test('expected RED: newly reproduced generator-parent QA must retrigger permanent VPS gate', async () => {
  const { paths } = await ruleSet()
  assert.equal(selects(paths, 'tests/qa-m3-generator-parent-alias-regression-20261015.test.mjs'), true,
    'independent generator output-path QA #3038 lacks permanent-runner PR trigger')
})

test('expected RED: reviewed private M3 field-kit source AND its own acceptance suite must trigger', async () => {
  const { paths } = await ruleSet()
  const missing = [
    'scripts/m3-prepare-field-kit.mjs',
    'tests/product-m3-private-field-kit-20261015.test.mjs',
  ].filter(path => !selects(paths, path))
  assert.deepEqual(missing, [],
    'M3 reviewed human field-kit source/tests on product owner #2827 must both trigger trusted VPS')
})

test('expected RED: this QA trigger-policy contract must rerun itself on the permanent runner', async () => {
  const { paths } = await ruleSet()
  assert.equal(selects(paths, OWN_QA), true,
    'M3 path-coverage contract could be deleted or weakened without any permanent M3 gate')
})
