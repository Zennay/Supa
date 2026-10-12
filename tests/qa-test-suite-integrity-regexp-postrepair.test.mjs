import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Independent postrepair #938 check on frozen #1910. The original AST guard
// is invoked, but none of the candidate code (including regexps) is executed.
const contract = readFileSync(new URL('./test-suite-integrity-contract.test.mjs', import.meta.url), 'utf8')
const start = contract.indexOf('function propertyName(')
const stop = contract.indexOf("\ntest('disabled-test detector catches", start)
assert.ok(start > 0 && stop > start, 'expected real detector source')
const { findDisabledNodeTests } = new Function('ts',
  'const disabledModes = new Set(["only", "skip", "todo"]);\n' +
  'const nodeTestExports = new Set(["describe", "it", "suite", "test"]);\n' +
  contract.slice(start, stop) + '\nreturn { findDisabledNodeTests }',
)(ts)

test('QA #938 independent: all node:test exports reject RegExp literal option values', () => {
  const source = [
    "import test, { it, suite, describe } from 'node:test'",
    "test('skip', { skip: /x/ }, () => {})",
    "it('todo', { todo: /[a-z]/i }, () => {})",
    "suite('only', { only: /(?:)/u }, () => {})",
    "describe('skip', { skip: /a\\/b/g }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(source).map(x => x.mode),
    ['skip', 'todo', 'only', 'skip'])
})

test('QA #938 independent: namespace, default and aliased imports retain RegExp guard', () => {
  const source = [
    "import * as T from 'node:test'",
    "import { test as check } from 'node:test'",
    "T.test('a', { todo: /x/m }, () => {})",
    "T['it']('b', { ['on' + 'ly']: /y/ }, () => {})",
    "check('c', { skip: /z/ }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(source).map(x => x.mode),
    ['todo', 'only', 'skip'])
})

test('QA #938 independent: multiline static regexps report call location', () => {
  const source = [
    "import test from 'node:test'",
    "test('normal', () => {})",
    "test('deferred', {",
    "  todo: /later/",
    "}, () => {})",
    "test('focused', { only: /focus/ }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(source).map(x => [x.mode, x.line]),
    [['todo', 3], ['only', 6]])
})

test('QA #938 independent: unrelated, dynamic and regexp method calls stay untouched', () => {
  const source = [
    "import test from 'node:test'",
    "import * as T from 'node:test'",
    "const expression = /literal/",
    "test('dynamic', { skip: expression }, () => {})",
    "test('call', { todo: /x/.test('x') }, () => {})",
    "another('unrelated', { skip: /x/ }, () => {})",
    "T.notTest('unrelated', { only: /x/ }, () => {})",
    "test('ok', { skip: false, todo: null, only: 0 }, () => {})",
    "test('ok2', () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(source), [])
})

test('QA #938 independent: source inspection never runs candidate test bodies', () => {
  const source = [
    "import test from 'node:test'",
    "test('not executed', { skip: /x/ }, () => { throw Error('executed') })",
    "test('not executed', { todo: /x/y }, () => { throw Error('executed') })",
    "test('still normal', () => { throw Error('executed') })",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(source).map(x => x.mode), ['skip', 'todo'])
})
