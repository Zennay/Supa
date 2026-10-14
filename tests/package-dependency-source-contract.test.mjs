import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const manifestUrl = new URL('../package.json', import.meta.url)
const dependencyGroups = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const registryRange = /^(?:\^|~|>=?|<=?|=)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

function forbiddenDependencySources(manifest) {
  const findings = []
  for (const group of dependencyGroups) {
    const entries = manifest[group] ?? {}
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
      findings.push(group + ': expected a dependency object')
      continue
    }
    for (const [name, range] of Object.entries(entries)) {
      if (typeof range !== 'string' || !registryRange.test(range)) {
        findings.push(group + '.' + name + ': non-pinned-registry dependency source')
      }
    }
  }
  return findings
}

test('dependency source boundary accepts explicit registry semver ranges', () => {
  assert.deepEqual(forbiddenDependencySources({
    dependencies: { react: '^19.1.1', 'react-dom': '~19.1.1' },
    devDependencies: { vite: '7.1.7', typescript: '>=5.9.2' },
  }), [])
})

test('dependency source boundary rejects remote, local, alias and unbounded specs', () => {
  for (const spec of [
    'git+https://github.com/example/project.git',
    'github:example/project',
    'https://example.com/archive.tgz',
    'file:../local',
    'link:../local',
    'workspace:*',
    'npm:another-package@1.0.0',
    '*',
    'latest',
    '',
  ]) {
    assert.equal(forbiddenDependencySources({ dependencies: { candidate: spec } }).length, 1, spec)
  }
})

test('dependency source boundary applies to all dependency groups and malformed entries', () => {
  for (const group of dependencyGroups) {
    assert.equal(forbiddenDependencySources({ [group]: { candidate: 'file:../unsafe' } }).length, 1, group)
    assert.equal(forbiddenDependencySources({ [group]: [] }).length, 1, group)
  }
})

test('production package manifest uses explicit registry dependency ranges', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
  assert.deepEqual(forbiddenDependencySources(manifest), [])
})
