import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import test from 'node:test'

// This is a static dependency check, not execution of retailer collectors.
// If an M3 CLI imports a new local module (even indirectly), the permanent
// M3 report job must rerun on PRs changing that module.
const root = resolve('.')
const workflowPath = '.github/workflows/m3-observed-week-report.yml'
const entrypoints = [
  'scripts/m3-create-observation-sheet.mjs',
  'scripts/m3-build-observed-study.mjs',
  'scripts/m3-assess-observed-week.mjs',
]

function directLocalImports(path) {
  const source = readFileSync(join(root, path), 'utf8')
  const imports = [
    ...source.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*['"](\.[^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g),
  ]
  return [...new Set(imports.map((match) => {
    const absolute = resolve(root, dirname(path), match[1])
    const repositoryPath = relative(root, absolute)
    assert.ok(repositoryPath && !repositoryPath.startsWith('..' + sep) && repositoryPath !== '..',
      'import may not escape repository: ' + path + ' -> ' + match[1])
    assert.equal(existsSync(absolute), true, 'missing imported module: ' + repositoryPath)
    return repositoryPath.split(sep).join('/')
  }))]
}

function localM3Closure() {
  const visited = new Set()
  const pending = [...entrypoints]
  while (pending.length) {
    const path = pending.pop()
    if (visited.has(path)) continue
    visited.add(path)
    for (const dependency of directLocalImports(path)) {
      if (!visited.has(dependency)) pending.push(dependency)
    }
    assert.ok(visited.size + pending.length < 200,
      'M3 dependency graph unexpectedly exceeds bounded test contract')
  }
  return visited
}

function triggeredPaths(workflow) {
  const block = /^  pull_request:\s*\n([\s\S]*?)(?=^  workflow_dispatch:|^concurrency:|^permissions:)/m.exec(workflow)?.[1]
  assert.ok(block, 'M3 permanent gate must retain pull_request path filters')
  return new Set(
    [...block.matchAll(/^\s+-\s+["']([^"']+)["']\s*$/gm)].map((match) => match[1]),
  )
}

function assertCompleteTriggerClosure(workflow) {
  const triggerPaths = triggeredPaths(workflow)
  assert.ok(triggerPaths.has(workflowPath), 'workflow edits must rerun the M3 gate')
  assert.ok(triggerPaths.has('tests/m3-workflow-transitive-trigger-closure.test.mjs'),
    'this QA contract must retrigger the M3 permanent gate when edited')
  const closure = localM3Closure()
  assert.ok(closure.size >= 12, 'unexpectedly small observed-week module graph')
  for (const dependency of closure) {
    assert.ok(triggerPaths.has(dependency),
      'M3 report gate fails to trigger on a transitive import: ' + dependency)
  }
  return closure
}

test('M3 permanent gate covers the complete transitive local import graph', () => {
  const workflow = readFileSync(join(root, workflowPath), 'utf8')
  const closure = assertCompleteTriggerClosure(workflow)
  for (const critical of [
    'src/data/m2Fixture.ts',
    'src/domain/decimalPackArithmetic.ts',
    'src/domain/types.ts',
  ]) {
    assert.ok(closure.has(critical), 'critical real M3 dependency disappeared: ' + critical)
  }
})

test('M3 gate detects regressions when any critical trigger is removed', () => {
  const workflow = readFileSync(join(root, workflowPath), 'utf8')
  for (const critical of [
    'src/data/m2Fixture.ts',
    'src/domain/decimalPackArithmetic.ts',
    'src/domain/types.ts',
    'scripts/m3-build-observed-study.mjs',
  ]) {
    const removed = workflow.replace('      - "' + critical + '"\n', '')
    assert.notEqual(removed, workflow, 'fixture did not remove: ' + critical)
    assert.throws(() => assertCompleteTriggerClosure(removed),
      /fails to trigger on a transitive import/)
  }
})
