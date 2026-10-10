import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const config = JSON.parse(await readFile('tsconfig.app.json', 'utf8'))
const options = config.compilerOptions ?? {}

test('application TypeScript keeps strict compile-time validation enabled', () => {
  assert.equal(options.strict, true)
  assert.equal(options.isolatedModules, true)
  assert.equal(options.noEmit, true)
})

test('application source cannot silently bypass TypeScript safety', () => {
  assert.equal(
    options.allowJs,
    false,
    'application source must not allow JavaScript files to bypass strict TypeScript checks',
  )
  assert.equal(
    options.forceConsistentCasingInFileNames,
    true,
    'application imports must keep portable file-name casing checks enabled',
  )
})

test('application TypeScript keeps the Vite bundler module contract', () => {
  assert.equal(options.module, 'ESNext')
  assert.equal(options.moduleResolution, 'Bundler')
  assert.equal(options.allowImportingTsExtensions, true)
})
