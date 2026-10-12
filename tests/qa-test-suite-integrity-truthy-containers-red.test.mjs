import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Expected-RED reproduction for #938: JS container literals are truthy
// when supplied as node:test skip/todo/only options. No candidate bodies run.
const contract = readFileSync(new URL('./test-suite-integrity-contract.test.mjs', import.meta.url), 'utf8')
const begin = contract.indexOf('function propertyName(')
const end = contract.indexOf("\ntest('disabled-test detector catches", begin)
assert.ok(begin > 0 && end > begin)
const { findDisabledNodeTests } = new Function('ts',
  'const disabledModes = new Set(["only", "skip", "todo"]);\n' +
  'const nodeTestExports = new Set(["describe", "it", "suite", "test"]);\n' +
  contract.slice(begin, end) + '\nreturn { findDisabledNodeTests }',
)(ts)

test('QA #938: empty array and object literal flags must be recognized as truthy', () => {
  const source = [
    "import test, { it, describe } from 'node:test'",
    "test('empty array', { skip: [] }, () => {})",
    "it('empty object', { todo: {} }, () => {})",
    "describe('focused array', { only: [] }, () => {})",
    "test('focused object', { only: {} }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(source).map(hit => hit.mode),
    ['skip', 'todo', 'only', 'only'])
})

test('QA #938: nested literal containers and alias/computed option keys are truthy', () => {
  const source = [
    "import * as nodeTest from 'node:test'",
    "import { default as check } from 'node:test'",
    "nodeTest.test('nonempty array', { ['sk' + 'ip']: [false] }, () => {})",
    "nodeTest.it('nested object', { todo: { explanation: false } }, () => {})",
    "check('only array', { only: [0, null] }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(source).map(hit => hit.mode),
    ['skip', 'todo', 'only'])
})

test('QA #938: empty and false primitives do not disable tests', () => {
  const source = [
    "import test from 'node:test'",
    "test('enabled', { skip: false, todo: null, only: 0 }, () => {})",
    "test('enabled empty string', { skip: '', todo: 0n }, () => {})",
    "test('ordinary', () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(source), [])
})

test('QA #938: unknown expressions, unrelated helpers and inert examples remain ignored', () => {
  const source = [
    "import test from 'node:test'",
    "const container = []",
    "test('dynamic', { skip: container }, () => {})",
    "foreignTest('different library', { todo: [] }, () => {})",
    "// test('comment', { skip: [] }, () => {})",
    'const example = "test(\'string\', { only: {} })"',
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(source), [])
})
