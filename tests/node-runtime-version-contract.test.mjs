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

test('local Node runtime pin matches hosted CI', () => {
  assert.equal(nodeVersion, '22')
  assert.match(
    ciWorkflow,
    /^\s+node-version:\s*22\s*$/m,
    'hosted CI must stay on the same Node major as .nvmrc',
  )
})

test('runtime pin protects the Node-native TypeScript test path', () => {
  assert.match(
    packageJson.scripts.test,
    /--experimental-strip-types/,
    'runtime pin is required while tests depend on Node type stripping',
  )
})
