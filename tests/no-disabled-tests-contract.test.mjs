import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const testsDir = new URL('./', import.meta.url)
const self = new URL(import.meta.url).pathname.split('/').at(-1)
const aliases = ['test', 'it', 'describe', 'suite']
const disabledMembers = ['skip', 'todo']

test('canonical regression suite contains no explicitly disabled tests', async () => {
  const files = (await readdir(testsDir))
    .filter((name) => name.endsWith('.test.mjs') && name !== self)
    .sort()

  assert.ok(files.length > 0, 'expected at least one canonical regression file')

  for (const file of files) {
    const source = await readFile(new URL(file, testsDir), 'utf8')

    for (const alias of aliases) {
      for (const member of disabledMembers) {
        const needle = alias + '.' + member
        assert.equal(
          source.includes(needle),
          false,
          `${file} explicitly disables a regression with ${needle}`,
        )
      }
    }
  }
})
