import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const testsDir = new URL('./', import.meta.url)
const aliases = ['test', 'it', 'describe', 'suite']
const disabledMembers = ['skip', 'todo']
const disabledCallPattern = new RegExp(
  `\\b(?:${aliases.join('|')})\\s*\\.\\s*(?:${disabledMembers.join('|')})\\s*\\(`,
)
const permanentlySkippedOptionPattern = /\bskip\s*:\s*true\b/

test('canonical regression suite contains no explicitly disabled tests', async () => {
  const files = (await readdir(testsDir))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()

  assert.ok(files.length > 0, 'expected at least one canonical regression file')

  for (const file of files) {
    const source = await readFile(new URL(file, testsDir), 'utf8')
    const disabledCall = source.match(disabledCallPattern)
    const permanentSkip = source.match(permanentlySkippedOptionPattern)

    assert.equal(
      disabledCall,
      null,
      `${file} explicitly disables a regression with ${disabledCall?.[0] ?? 'unknown call'}`,
    )
    assert.equal(
      permanentSkip,
      null,
      `${file} permanently disables a regression with a literal skip option`,
    )
  }
})

test('disabled-test guard permits conditional skip options but rejects literal true', () => {
  const literalSkip = ['skip', ': true'].join('')
  const conditionalSkip = ['skip', ": process.platform === 'win32'"].join('')

  assert.match(literalSkip, permanentlySkippedOptionPattern)
  assert.doesNotMatch(conditionalSkip, permanentlySkippedOptionPattern)
})
