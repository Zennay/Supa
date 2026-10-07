import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const ignoreLines = readFileSync(
  new URL('../.gitignore', import.meta.url),
  'utf8',
)
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)

test('local environment secrets stay ignored while example remains available', () => {
  const envIndex = ignoreLines.indexOf('.env')
  const envWildcardIndex = ignoreLines.indexOf('.env.*')
  const exampleExceptionIndex = ignoreLines.indexOf('!.env.example')

  assert.notEqual(envIndex, -1, '.env must remain ignored')
  assert.notEqual(envWildcardIndex, -1, '.env.* must remain ignored')
  assert.notEqual(
    exampleExceptionIndex,
    -1,
    '.env.example must remain explicitly allowed',
  )
  assert.ok(
    exampleExceptionIndex > envWildcardIndex,
    '.env.example exception must come after the .env.* ignore rule',
  )
})
