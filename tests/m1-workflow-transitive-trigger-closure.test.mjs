import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import test from 'node:test'

// No public pages are fetched by this test. It only reads tracked local files.
// Any imported dependency of an M1 source/evidence job must activate that job
// for same-repository PRs when its checked-in implementation changes.
const root = resolve('.')
const workflow = '.github/workflows/m1-data-capture.yml'
const m1JobScripts = [
  'scripts/m1-run-matching-benchmark.mjs',
  'scripts/m1-capture-sources.mjs',
  'scripts/m1-inspect-captures.mjs',
  'scripts/m1-evaluate-freshness.mjs',
  'scripts/m1-export-sanitized-candidates.mjs',
  'scripts/m1-build-evidence-summary.mjs',
  // Direct authorized HTML -> private-only price and archive is M1 source code.
  // Its changes must also activate the permanent capture/evidence gate.
  'scripts/retailer-approved-price-archive-run.mjs',
]

function localModule(parent, specifier) {
  const candidate = resolve(root, dirname(parent), specifier)
  const relativeCandidate = relative(root, candidate)
  assert.ok(relativeCandidate && !relativeCandidate.startsWith('..' + sep)
    && relativeCandidate !== '..', 'M1 import escapes tracked workspace')
  // Some TypeScript fixture modules use extensionless relative imports.
  const actual = [candidate, candidate + '.ts', candidate + '.mjs', candidate + '.js']
    .find((path) => existsSync(path))
  assert.ok(actual, 'M1 import path not found: ' + relativeCandidate)
  return relative(root, actual).split(sep).join('/')
}

function m1DependencyClosure() {
  const processed = new Set()
  const queued = [...m1JobScripts]
  while (queued.length) {
    const module = queued.pop()
    if (processed.has(module)) continue
    processed.add(module)
    const source = readFileSync(join(root, module), 'utf8')
    for (const match of source.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*['"](\.[^'"]+)['"]|\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const dependency = localModule(module, match[1] ?? match[2] ?? match[3])
      if (!processed.has(dependency)) queued.push(dependency)
    }
    assert.ok(processed.size + queued.length < 150, 'M1 graph exceeded test budget')
  }
  return processed
}

function triggerPaths(yaml) {
  const pathsSection = /^  pull_request:\s*\n([\s\S]*?)(?=^  workflow_dispatch:|^concurrency:)/m.exec(yaml)?.[1]
  assert.ok(pathsSection, 'M1 workflow must preserve PR path triggers')
  return new Set(
    [...pathsSection.matchAll(/^\s+-\s+["']([^"']+)["']\s*$/gm)].map((match) => match[1]),
  )
}

function assertM1ImportsAreCovered(yaml) {
  const triggers = triggerPaths(yaml)
  assert.ok(triggers.has(workflow))
  assert.ok(triggers.has('tests/m1-workflow-transitive-trigger-closure.test.mjs'),
    'M1 dependency guard edits must retrigger the permanent gate')
  const dependencies = m1DependencyClosure()
  assert.ok(dependencies.size >= 10, 'M1 CLI dependency graph unexpectedly shrank')
  for (const dependency of dependencies) {
    assert.ok(triggers.has(dependency),
      'M1 capture/evidence gate missing transitive import trigger: ' + dependency)
  }
  return dependencies
}

test('M1 permanent capture job keeps entire imported source/evidence graph trigger-covered', () => {
  const yaml = readFileSync(join(root, workflow), 'utf8')
  const files = assertM1ImportsAreCovered(yaml)
  for (const required of [
    'src/data/ingestion.ts',
    'src/data/normalize.ts',
    'src/data/schemaOrgProduct.ts',
    'src/domain/matching.ts',
  ]) assert.ok(files.has(required), 'M1 canonical dependency disappeared: ' + required)
})

test('M1 trigger contract fails closed if real source dependencies stop activating evidence gate', () => {
  const yaml = readFileSync(join(root, workflow), 'utf8')
  for (const dependency of [
    'src/data/ingestion.ts',
    'src/data/normalize.ts',
    'src/data/schemaOrgProduct.ts',
    'src/domain/matching.ts',
  ]) {
    const mutant = yaml.replace('      - "' + dependency + '"\n', '')
    assert.notEqual(mutant, yaml)
    assert.throws(() => assertM1ImportsAreCovered(mutant), /missing transitive import trigger/)
  }
})
