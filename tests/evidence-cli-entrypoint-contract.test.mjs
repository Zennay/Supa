import assert from 'node:assert/strict'
import { stat, readFile } from 'node:fs/promises'
import test from 'node:test'

const EVIDENCE_SCRIPT_PREFIX = /^(?:m1:|m3:|m4:|aud005:)/
const SAFE_NODE_COMMAND =
  /^node(?: --experimental-strip-types)? (scripts\/[a-z0-9][a-z0-9-]*\.mjs)(?: --[a-z0-9-]+)*$/i

async function readPackageScripts() {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
  return Object.entries(packageJson.scripts ?? {}).filter(([name]) =>
    EVIDENCE_SCRIPT_PREFIX.test(name),
  )
}

test('evidence npm scripts stay single checked-in Node entrypoints', async () => {
  const scripts = await readPackageScripts()

  assert.ok(scripts.length > 0, 'expected evidence CLI npm scripts')

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
