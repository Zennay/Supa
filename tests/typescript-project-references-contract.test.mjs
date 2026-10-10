import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const config = JSON.parse(
  readFileSync(new URL('../tsconfig.json', import.meta.url), 'utf8'),
)
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)
const appConfig = JSON.parse(
  readFileSync(new URL('../tsconfig.app.json', import.meta.url), 'utf8'),
)
const nodeConfig = JSON.parse(
  readFileSync(new URL('../tsconfig.node.json', import.meta.url), 'utf8'),
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

test('TypeScript project includes keep full app and build-config coverage', () => {
  assert.deepEqual(appConfig.include, ['src'])
  assert.deepEqual(nodeConfig.include, ['vite.config.ts'])
})

test('Vite build config remains a strict no-emit referenced TypeScript project', () => {
  const options = nodeConfig.compilerOptions ?? {}

  assert.equal(options.composite, true)
  assert.equal(options.noEmit, true)
  assert.equal(options.strict, true)
  assert.equal(options.module, 'ESNext')
  assert.equal(options.moduleResolution, 'Bundler')
})
