import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)

test('package remains explicitly non-publishable', () => {
  assert.equal(
    packageJson.private,
    true,
    'root package.json must keep the literal boolean private: true',
  )
})
