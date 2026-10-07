import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const nvmMajor = readFileSync(
  new URL('../.nvmrc', import.meta.url),
  'utf8',
).trim()
const npmConfig = readFileSync(
  new URL('../.npmrc', import.meta.url),
  'utf8',
)
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
const ciWorkflow = readFileSync(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8',
)

test('npm enforces the same Node major pinned for local and hosted CI', () => {
  assert.match(nvmMajor, /^\d+$/)
  assert.equal(packageJson.engines?.node, `${nvmMajor}.x`)
  assert.match(
    npmConfig,
    /^engine-strict=true$/m,
    'repository npm config must reject unsupported Node majors',
  )
  assert.match(
    ciWorkflow,
    new RegExp(`^\\s+node-version:\\s*${nvmMajor}\\s*$`, 'm'),
    'hosted CI must use the same Node major enforced by package.json',
  )
})

test('engine enforcement is singular and cannot be shadowed later in npm config', () => {
  const engineStrictEntries = npmConfig
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^engine-strict\s*=/.test(line))

  assert.deepEqual(
    engineStrictEntries,
    ['engine-strict=true'],
    'engine-strict must be enabled exactly once',
  )
})
