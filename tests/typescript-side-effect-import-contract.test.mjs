import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const config = JSON.parse(
  await readFile(new URL('../tsconfig.app.json', import.meta.url), 'utf8'),
)

test('application TypeScript config rejects unresolved side-effect imports', () => {
  assert.equal(config.compilerOptions.strict, true)
  assert.equal(config.compilerOptions.noEmit, true)
  assert.equal(config.compilerOptions.noUncheckedSideEffectImports, true)
})
