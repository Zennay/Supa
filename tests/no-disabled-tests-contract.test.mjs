import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const testsDir = new URL('./', import.meta.url)
const aliases = ['test', 'it', 'describe', 'suite']
const disabledMembers = ['skip', 'todo']
const disabledCallPattern = new RegExp(
  `\\b(?:${aliases.join('|')})\\s*\\.\\s*(?:${disabledMembers.join('|')})\\s*\\(`,
)

test('canonical regression suite contains no explicitly disabled tests', async () => {
  const files = (await readdir(testsDir))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()

  assert.ok(files.length > 0, 'expected at least one canonical regression file')

  for (const file of files) {
    const source = await readFile(new URL(file, testsDir), 'utf8')
    const match = source.match(disabledCallPattern)

    assert.equal(
      match,
      null,
      `${file} explicitly disables a regression with ${match?.[0] ?? 'unknown call'}`,
    )
  }
})
