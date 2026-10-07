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

function setupNodeVersions(workflowSource) {
  const lines = workflowSource.split(/\r?\n/)
  const versions = []

  for (let index = 0; index < lines.length; index += 1) {
    const setupNode = lines[index].match(
      /^(\s*)-\s+uses:\s+(?:(['"])actions\/setup-node@[^'"]+\2|actions\/setup-node@[^\s#]+)(?:\s+#.*)?$/,
    )
    if (!setupNode) continue

    const stepIndent = setupNode[1].length
    let withIndent = null
    let version = null

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor]
      if (!line.trim()) continue

      const indentation = line.match(/^\s*/)[0].length
      if (indentation <= stepIndent) break

      if (withIndent === null) {
        if (/^\s+with:\s*(?:#.*)?$/.test(line)) {
          withIndent = indentation
        }
        continue
      }

      if (indentation <= withIndent) {
        withIndent = null
        continue
      }

      const declaration = line.match(
        /^\s+node-version:\s*([^#\r\n]+?)\s*(?:#.*)?$/,
      )
      if (declaration) {
        version = declaration[1].trim().replace(/^['"]|['"]$/g, '')
      }
    }

    versions.push(version)
  }

  return versions
}

function assertHostedCiNodeVersions(workflowSource, expectedVersion) {
  const declarations = setupNodeVersions(workflowSource)

  assert.ok(
    declarations.length > 0,
    'hosted CI must contain at least one actions/setup-node step',
  )
  assert.equal(
    declarations.every((version) => version !== null),
    true,
    'every hosted CI setup-node step must declare its own explicit Node runtime version',
  )
  assert.deepEqual(
    declarations,
    declarations.map(() => expectedVersion),
    'every hosted CI setup-node Node runtime declaration must match .nvmrc',
  )
}

test('local Node runtime pin matches every hosted CI setup-node declaration', () => {
  assert.equal(nodeVersion, '22')
  assertHostedCiNodeVersions(ciWorkflow, nodeVersion)
})

test('runtime contract rejects a conflicting duplicate setup-node declaration', () => {
  assert.throws(
    () =>
      assertHostedCiNodeVersions(
        `
        steps:
          - uses: actions/setup-node@first
            with:
              node-version: 22
          - uses: actions/setup-node@second
            with:
              node-version: 20
        `,
        '22',
      ),
    /every hosted CI setup-node Node runtime declaration must match \.nvmrc/,
  )
})

test('runtime contract recognizes quoted setup-node steps', () => {
  assert.deepEqual(
    setupNodeVersions(`
      steps:
        - uses: "actions/setup-node@v4"
          with:
            node-version: 22
        - uses: 'actions/setup-node@v4'
          with:
            node-version: 22
        - uses: actions/checkout@v4
    `),
    ['22', '22'],
  )
})

test('runtime contract rejects quoted setup-node without its own Node declaration', () => {
  assert.throws(
    () =>
      assertHostedCiNodeVersions(
        `
        steps:
          - uses: "actions/setup-node@v4"
            with:
              node-version: 22
          - uses: 'actions/setup-node@v4'
            with:
              cache: npm
        `,
        '22',
      ),
    /every hosted CI setup-node step must declare its own explicit Node runtime version/,
  )
})

test('runtime contract rejects setup-node without its own explicit Node declaration', () => {
  assert.throws(
    () =>
      assertHostedCiNodeVersions(
        `
        node-version: 22
        steps:
          - uses: actions/setup-node@first
            with:
              cache: npm
        `,
        '22',
      ),
    /every hosted CI setup-node step must declare its own explicit Node runtime version/,
  )
})

test('runtime contract rejects hosted CI with no setup-node step', () => {
  assert.throws(
    () => assertHostedCiNodeVersions('steps:\n  - run: npm test\n', '22'),
    /hosted CI must contain at least one actions\/setup-node step/,
  )
})

test('runtime pin protects the Node-native TypeScript test path', () => {
  assert.match(
    packageJson.scripts.test,
    /--experimental-strip-types/,
    'runtime pin is required while tests depend on Node type stripping',
  )
})
