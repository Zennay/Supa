import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Synthetic expected-RED for #938: regular expression literals are truthy
// node:test option values. Execute the actual AST detector only, not candidate
// test bodies or regexps. This does not change application or M3 evidence.
const contract = readFileSync(new URL('./test-suite-integrity-contract.test.mjs', import.meta.url), 'utf8')
const start = contract.indexOf('function propertyName(')
const end = contract.indexOf("\ntest('disabled-test detector catches", start)
assert.ok(start > 0 && end > start, 'expected frozen AST detector')
const { findDisabledNodeTests } = new Function('ts',
  'const disabledModes = new Set(["only", "skip", "todo"]);\n' +
  'const nodeTestExports = new Set(["describe", "it", "suite", "test"]);\n' +
  contract.slice(start, end) +
  '\nreturn { findDisabledNodeTests }',
)(ts)

test('QA #938 RED: regex literals are truthy disabled/focused options', () => {
  const source = [
    "import test, { it, describe } from 'node:test'",
    "test('one', { skip: /unavailable/ }, () => { throw Error('not executed') })",
    "it('two', { todo: /later/i }, () => { throw Error('not executed') })",
    "describe('three', { only: /focused/u }, () => { throw Error('not executed') })",
  ].join('\n')
  assert.deepEqual(
    findDisabledNodeTests(source).map(({ mode, line }) => ({ mode, line })),
    [{ mode: 'skip', line: 2 }, { mode: 'todo', line: 3 }, { mode: 'only', line: 4 }],
  )
})

test('QA #938 RED: regexp option keys work through computed namespace and aliases', () => {
  const source = [
    "import * as T from 'node:test'",
    "import { test as check } from 'node:test'",
    "T['te' + 'st']('one', { ['sk' + 'ip']: /a/ }, () => {})",
    "T.it('two', { todo: /b/ }, () => {})",
    "check('three', { ['on' + 'ly']: /c/ }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(source).map(x => x.mode), ['skip', 'todo', 'only'])
})

test('QA #938 controls: inert regex strings and unrelated/dynamic options are ignored', () => {
  const source = [
    "import test from 'node:test'",
    "import * as T from 'node:test'",
    "const expression = /not-a-literal-option/",
    "test('normal', () => {})",
    "test('dynamic', { skip: expression }, () => { throw Error('not executed') })",
    "test('function call', { only: /x/.test('x') }, () => {})",
    "unrelated('other API', { skip: /x/ }, () => {})",
    "T.helper('other API', { todo: /x/ }, () => {})",
    "// test('comment', { skip: /x/ }, () => {})",
    "const sample = 'test(\\'inert\\', { only: /x/ })'",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(source), [])
})
