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

test('application TypeScript keeps the Vite bundler module contract', () => {
  assert.equal(options.module, 'ESNext')
  assert.equal(options.moduleResolution, 'Bundler')
  assert.equal(options.allowImportingTsExtensions, true)
})
