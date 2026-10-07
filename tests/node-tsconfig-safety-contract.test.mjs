import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const config = JSON.parse(
  readFileSync(new URL('../tsconfig.node.json', import.meta.url), 'utf8'),
)

test('Node/Vite TypeScript project keeps strict build safety', () => {
  assert.equal(config.compilerOptions.strict, true)
  assert.equal(config.compilerOptions.composite, true)
  assert.equal(config.compilerOptions.noEmit, true)
  assert.equal(config.compilerOptions.moduleResolution, 'Bundler')
})

test('Node/Vite TypeScript project stays scoped to the Vite config', () => {
  assert.deepEqual(config.include, ['vite.config.ts'])
})
