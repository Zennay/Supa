import assert from 'node:assert/strict'
import { stat, readFile } from 'node:fs/promises'
import test from 'node:test'

const EVIDENCE_SCRIPT_PREFIX = /^(?:m1:|m3:|m4:|aud005:)/
const EXPECTED_EVIDENCE_SCRIPTS = [
  'aud005:record-retailer-response',
  'm1:compare-captures',
  'm1:evaluate-freshness',
  'm1:evidence-summary',
  'm1:export-candidates',
  'm1:inspect-captures',
  'm1:matching-benchmark',
  'm1:promote-reviewed',
  'm1:source-permission-gate',
  'm1:source-production-ready',
  'm3:assess-observed-week',
  'm3:build-observed-study',
  'm3:create-observation-sheet',
  'm4:validate-beta-session',
]
const SAFE_NODE_COMMAND =
  /^node(?: --experimental-strip-types)? (scripts\/[a-z0-9][a-z0-9-]*\.mjs)(?: --[a-z0-9-]+)*$/i

async function readPackageScripts() {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
  return Object.entries(packageJson.scripts ?? {}).filter(([name]) =>
    EVIDENCE_SCRIPT_PREFIX.test(name),
  )
}

test('required evidence npm scripts cannot silently disappear', async () => {
  const scripts = await readPackageScripts()
  const names = scripts.map(([name]) => name).sort()

  assert.deepEqual(
    names,
    EXPECTED_EVIDENCE_SCRIPTS,
    'evidence CLI set changed; review the executable evidence boundary explicitly',
  )
})

test('evidence npm scripts stay single checked-in Node entrypoints', async () => {
  const scripts = await readPackageScripts()

  for (const [name, command] of scripts) {
    assert.equal(typeof command, 'string', name + ' must remain a string npm command')
    assert.doesNotMatch(
      command,
      /(?:&&|\|\||;|\$\(|`|\n|\r)/,
      name + ' must not add shell chaining or command substitution',
    )

    const match = SAFE_NODE_COMMAND.exec(command)
    assert.ok(
      match,
      name + ' must invoke exactly one repo-local scripts/*.mjs entrypoint through Node',
    )

    const entrypoint = match[1]
    assert.equal(
      entrypoint.includes('..'),
      false,
      name + ' entrypoint must not traverse outside scripts/',
    )

    const file = await stat(entrypoint)
    assert.equal(file.isFile(), true, name + ' entrypoint must exist as a file')
  }
})

test('evidence npm script names stay wired to their own evidence domains', async () => {
  const scripts = await readPackageScripts()

  for (const [name, command] of scripts) {
    const entrypoint = SAFE_NODE_COMMAND.exec(command)?.[1]
    assert.ok(entrypoint, name + ' must have a valid Node entrypoint')

    const expectedPrefix = name.split(':', 1)[0]
    assert.equal(
      entrypoint.startsWith('scripts/' + expectedPrefix + '-'),
      true,
      name + ' must stay wired to its own evidence domain',
    )
  }
})
test('production-ready source gate cannot degrade to permission-only mode', async () => {
  const scripts = Object.fromEntries(await readPackageScripts())
  const permissionGate = scripts['m1:source-permission-gate']
  const productionGate = scripts['m1:source-production-ready']

  assert.doesNotMatch(
    permissionGate,
    /(?:^|\s)--require-production-ready(?:\s|$)/,
    'permission-only gate must remain usable without asserting production readiness',
  )
  assert.match(
    productionGate,
    /(?:^|\s)--require-production-ready(?:\s|$)/,
    'production-ready alias must preserve the explicit strict-mode flag',
  )
})
