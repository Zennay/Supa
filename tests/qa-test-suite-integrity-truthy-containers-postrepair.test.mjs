import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Independent postrepair assurance for #938. Use the actual QA AST guard
// without executing any synthetic candidate test bodies.
const contract = readFileSync(new URL('./test-suite-integrity-contract.test.mjs', import.meta.url), 'utf8')
const start = contract.indexOf('function propertyName(')
const stop = contract.indexOf("\ntest('disabled-test detector catches", start)
assert.ok(start > 0 && stop > start)
const { findDisabledNodeTests } = new Function('ts',
  'const disabledModes = new Set(["only", "skip", "todo"]);\n' +
  'const nodeTestExports = new Set(["describe", "it", "suite", "test"]);\n' +
  contract.slice(start, stop) + '\nreturn { findDisabledNodeTests }',
)(ts)

test('QA #938 independent: every node:test API sees empty truthy container options', () => {
  const code = [
    "import test, { it, suite, describe } from 'node:test'",
    "test('one', { skip: {} }, () => {})",
    "it('two', { todo: [] }, () => {})",
    "suite('three', { only: {} }, () => {})",
    "describe('four', { skip: [] }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(code).map(x => x.mode),
    ['skip', 'todo', 'only', 'skip'])
})

test('QA #938 independent: nested nonempty containers and literal aliases are truthy', () => {
  const code = [
    "import * as T from 'node:test'",
    "import { test as check } from 'node:test'",
    "T['te' + 'st']('a', { ['to' + 'do']: { nested: [] } }, () => {})",
    "T.it('b', { skip: [null] }, () => {})",
    "check('c', { only: { enabled: false } }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(code).map(x => x.mode),
    ['todo', 'skip', 'only'])
})

test('QA #938 independent: line locations refer to real disabling calls', () => {
  const code = [
    "import test from 'node:test'",
    "test('enabled', () => {})",
    "test('disabled', { skip: [] }, () => {})",
    "test('focused', { only: {} }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(code).map(x => ({ mode: x.mode, line: x.line })),
    [{ mode: 'skip', line: 3 }, { mode: 'only', line: 4 }])
})

test('QA #938 independent: primitive falsey values and unrelated APIs do not trigger', () => {
  const code = [
    "import test from 'node:test'",
    "import * as nodeTest from 'node:test'",
    "test('zero', { skip: 0, todo: 0n, only: false }, () => {})",
    "test('empty', { skip: '', todo: null }, () => {})",
    "foreign('unrelated', { skip: [] }, () => {})",
    "nodeTest.notATest('unrelated', { only: {} }, () => {})",
    "test('ordinary', () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(code), [])
})

test('QA #938 independent: candidate bodies and dynamic options are not evaluated', () => {
  const code = [
    "import test from 'node:test'",
    "const skip = []",
    "test('dynamic', { skip }, () => { throw new Error('must never execute') })",
    "test('nested dynamic', { only: Object.freeze({}) }, () => { throw 1 })",
    "test('literal', { todo: [] }, () => { throw new Error('must never execute') })",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(code).map(x => x.mode), ['todo'])
})
