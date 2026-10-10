import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const packageJsonUrl = new URL('../package.json', import.meta.url)

test('package manifest keeps ESM runtime mode enabled', async () => {
  const packageJson = JSON.parse(await readFile(packageJsonUrl, 'utf8'))

  assert.equal(packageJson.type, 'module')
})
