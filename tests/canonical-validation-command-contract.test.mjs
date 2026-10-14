import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import test from 'node:test'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const scripts = pkg.scripts ?? {}
const testFiles = (await readdir(new URL('./', import.meta.url)))
  .filter((name) => name.endsWith('.test.mjs'))

test('the canonical test command discovers every committed Node test file', () => {
  assert.ok(testFiles.length > 0, 'expected at least one test file')
  assert.match(scripts.test ?? '', /^node --experimental-strip-types --test tests\/\*\.test\.mjs$/)
  for (const file of testFiles) {
    assert.match(file, /^[^/]+\.test\.mjs$/)
  }
})

test('release validation scripts cannot silently mask failed gates', () => {
  for (const name of ['test', 'build', 'm1:matching-benchmark', 'm1:source-permission-gate']) {
    const command = scripts[name]
    assert.equal(typeof command, 'string', `missing required ${name} validation script`)
    assert.ok(command.trim(), `empty required ${name} validation script`)
    assert.doesNotMatch(command, /(?:\|\|\s*(?:true|:)|;\s*(?:true|:)(?:\s|$)|--test-name-pattern\b|--test-only\b)/, `${name} must not suppress failures or focus a subset`)
  }
})

test('production build runs the TypeScript project gate before bundling', () => {
  assert.match(scripts.build ?? '', /^tsc -b && vite build$/)
})
