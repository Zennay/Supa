import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const config = JSON.parse(
  readFileSync(new URL('../tsconfig.json', import.meta.url), 'utf8'),
)
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)

test('root TypeScript build keeps both project references', () => {
  assert.deepEqual(config.files, [])
  assert.deepEqual(
    config.references,
    [
      { path: './tsconfig.app.json' },
      { path: './tsconfig.node.json' },
    ],
  )
})

test('production build typechecks both projects before Vite bundling', () => {
  assert.equal(packageJson.scripts.build, 'tsc -b && vite build')
})
