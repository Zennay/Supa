import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const nodeVersion = readFileSync(
  new URL('../.nvmrc', import.meta.url),
  'utf8',
).trim()
const ciWorkflow = readFileSync(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8',
)
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)

function assertHostedCiNodeVersions(workflowSource, expectedVersion) {
  const declarations = [
    ...workflowSource.matchAll(/^\s+node-version:\s*([^#\r\n]+?)\s*(?:#.*)?$/gm),
  ].map((match) => match[1].trim().replace(/^['"]|['"]$/g, ''))

  assert.ok(
    declarations.length > 0,
    'hosted CI must declare at least one explicit Node runtime version',
  )
  assert.deepEqual(
    declarations,
    declarations.map(() => expectedVersion),
    'every hosted CI Node runtime declaration must match .nvmrc',
  )
}

test('local Node runtime pin matches every hosted CI declaration', () => {
  assert.equal(nodeVersion, '22')
  assertHostedCiNodeVersions(ciWorkflow, nodeVersion)
})

test('runtime contract rejects a conflicting duplicate hosted CI Node declaration', () => {
  assert.throws(
    () =>
      assertHostedCiNodeVersions(
        `
        with:
          node-version: 22
        with:
          node-version: 20
        `,
        '22',
      ),
    /every hosted CI Node runtime declaration must match \.nvmrc/,
  )
})

test('runtime contract rejects hosted CI with no explicit Node declaration', () => {
  assert.throws(
    () => assertHostedCiNodeVersions('steps:\n  - run: npm test\n', '22'),
    /hosted CI must declare at least one explicit Node runtime version/,
  )
})

test('runtime pin protects the Node-native TypeScript test path', () => {
  assert.match(
    packageJson.scripts.test,
    /--experimental-strip-types/,
    'runtime pin is required while tests depend on Node type stripping',
  )
})
