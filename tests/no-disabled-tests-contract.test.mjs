import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'

const testsDir = new URL('./', import.meta.url)
const aliases = ['test', 'it', 'describe', 'suite']
const disabledMembers = ['skip', 'todo']
const disabledCallPattern = new RegExp(
  `\\b(?:${aliases.join('|')})\\s*\\.\\s*(?:${disabledMembers.join('|')})\\s*\\(`,
)
const permanentlyDisabledOptionPattern =
  /\b(?:skip|todo)\s*:\s*(?:true\b|'[^'\r\n]+'|"[^"\r\n]+")/

test('canonical regression suite contains no explicitly disabled tests', async () => {
  const files = (await readdir(testsDir))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()

  assert.ok(files.length > 0, 'expected at least one canonical regression file')

  for (const file of files) {
    const source = await readFile(new URL(file, testsDir), 'utf8')
    const disabledCall = source.match(disabledCallPattern)
    const permanentDisable = source.match(permanentlyDisabledOptionPattern)

    assert.equal(
      disabledCall,
      null,
      `${file} explicitly disables a regression with ${disabledCall?.[0] ?? 'unknown call'}`,
    )
    assert.equal(
      permanentDisable,
      null,
      `${file} permanently disables a regression with a literal test option`,
    )
  }
})

test('disabled-test guard permits conditional skips but rejects literal disabled options', () => {
  const literalSkip = ['skip', ': true'].join('')
  const literalTodo = ['todo', ': true'].join('')
  const literalStringSkip = ['skip', ": 'flaky regression'"].join('')
  const literalStringTodo = ['todo', ': "pending regression"'].join('')
  const emptyStringSkip = ['skip', ": ''"].join('')
  const conditionalSkip = ['skip', ": process.platform === 'win32'"].join('')

  assert.match(literalSkip, permanentlyDisabledOptionPattern)
  assert.match(literalTodo, permanentlyDisabledOptionPattern)
  assert.match(literalStringSkip, permanentlyDisabledOptionPattern)
  assert.match(literalStringTodo, permanentlyDisabledOptionPattern)
  assert.doesNotMatch(emptyStringSkip, permanentlyDisabledOptionPattern)
  assert.doesNotMatch(conditionalSkip, permanentlyDisabledOptionPattern)
})
