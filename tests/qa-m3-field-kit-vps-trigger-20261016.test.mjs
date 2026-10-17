import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Independent QA for #2833: do not modify the concurrently owned workflow (#2604).
// A passing hosted test does NOT prove that the permanent self-hosted M3 job ran.
const workflowUrl = new URL('../.github/workflows/m3-observed-week-report.yml', import.meta.url)
const expected = Object.freeze([
  'docs/product/m3-one-command-human-field-kit.md',
  'scripts/m3-prepare-field-kit.mjs',
  'tests/product-m3-private-field-kit-20261015.test.mjs',
  'tests/qa-m3-field-kit-vps-trigger-20261016.test.mjs',
])

function selectedPaths(yaml) {
  const block = /^  pull_request:\s*\n {4}paths:\s*\n((?: {6}- [^\n]+\n)+)/mu.exec(yaml)
  assert.ok(block, 'M3 permanent report requires an explicit pull_request paths selector')
  const list = block[1].trimEnd().split('\n').map((line) => JSON.parse(line.trim().slice(2)))
  assert.equal(new Set(list).size, list.length, 'duplicate path selector is not a clear contract')
  return list
}

function covers(path, trigger) {
  if (path === trigger) return true
  // Only the exact supported GitHub glob shapes used in this path contract.
  // Avoid accidentally treating a substring or nearby path as permission.
  if (!trigger.includes('*')) return false
  const escaped = trigger.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
  const pattern = escaped.replace(/\*\*/g, '\\u0000').replace(/\*/g, '[^/]*').replace(/\\u0000/g, '.*')
  return new RegExp('^' + pattern + '$', 'u').test(path)
}

function assertFieldKitSelected(yaml) {
  const paths = selectedPaths(yaml)
  for (const path of expected) {
    assert.ok(paths.some((trigger) => covers(path, trigger)),
      'permanent M3 self-hosted PR gate omits field-kit change: ' + path)
  }
}

test('M3 permanent self-hosted gate selects the field-kit source, acceptance and operator guide (#2833)', async () => {
  const yaml = await readFile(workflowUrl, 'utf8')
  assertFieldKitSelected(yaml)
})

test('M3 field-kit selector test detects each missing path, not a nearby similarly named file', async () => {
  const yaml = await readFile(workflowUrl, 'utf8')
  const block = /^  pull_request:\s*\n {4}paths:\s*\n((?: {6}- [^\n]+\n)+)/mu.exec(yaml)
  assert.ok(block)
  const syntheticAccepted = yaml.replace(block[0], block[0] +
    expected.map((path) => '      - ' + JSON.stringify(path) + '\n').join(''))
  assert.doesNotThrow(() => assertFieldKitSelected(syntheticAccepted))
  for (const path of expected) {
    const missing = syntheticAccepted.replace('      - ' + JSON.stringify(path) + '\n', '')
    assert.notEqual(missing, syntheticAccepted)
    assert.throws(() => assertFieldKitSelected(missing), /omits field-kit change:/)
  }
  const lookalike = syntheticAccepted.replace(
    '      - "scripts/m3-prepare-field-kit.mjs"\n',
    '      - "scripts/m3-prepare-field-kit.mjs.backup"\n',
  )
  assert.throws(() => assertFieldKitSelected(lookalike), /omits field-kit change: scripts\/m3-prepare-field-kit/)
})

test('M3 field-kit selection must retain same-repo main-PR admission and main-only manual dispatch', async () => {
  const yaml = await readFile(workflowUrl, 'utf8')
  const condition = "    if: (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main') || (github.event_name == 'pull_request' && github.base_ref == 'main' && github.event.pull_request.head.repo.full_name == github.repository)"
  assert.ok(yaml.includes(condition), 'self-hosted job must reject forks and non-main targets before allocation')
  assert.match(yaml, /^    runs-on: self-hosted\s*$/mu)
  assert.match(yaml, /test "\$\(hostname -s\)" = "vps-bb300bba"/u)
  const upload = /      - name: Upload M3 field-run pack\n        if: github\.event_name == 'workflow_dispatch'\n/u
  assert.match(yaml, upload, 'PRs must never publish a private field-kit artifact')
  for (const mutation of [
    yaml.replace(condition, '    if: true'),
    yaml.replace("github.ref == 'refs/heads/main'", "github.ref == 'refs/heads/feature'"),
    yaml.replace(upload, '      - name: Upload M3 field-run pack\n'),
  ]) {
    assert.notEqual(mutation, yaml)
    assert.equal(
      mutation.includes(condition) && upload.test(mutation),
      false,
      'authorization-relaxing mutation must be detected',
    )
  }
})
