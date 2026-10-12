import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// QA-only independent acceptance after #938 BigInt option fix.
// Exercise the frozen real parser/guard, never execute candidate test bodies.
const file = readFileSync(new URL('./test-suite-integrity-contract.test.mjs', import.meta.url), 'utf8')
const begin = file.indexOf('function propertyName(')
const end = file.indexOf("\ntest('disabled-test detector catches", begin)
assert.ok(begin > 0 && end > begin)
const { findDisabledNodeTests } = new Function('ts',
  'const disabledModes = new Set(["only", "skip", "todo"]);\n' +
  'const nodeTestExports = new Set(["describe", "it", "suite", "test"]);\n' +
  file.slice(begin, end) + '\nreturn { findDisabledNodeTests }',
)(ts)

test('QA #938 BigInt postrepair: all radix and separated truthy literals disable test cases', () => {
  const code = [
    "import test, { it, describe } from 'node:test'",
    "test('hex', { skip: 0xFFn }, () => {})",
    "it('binary', { todo: 0b1000n }, () => {})",
    "describe('octal', { only: 0o12n }, () => {})",
    "test('separator', { skip: 9_007_199_254_740_993n }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(code).map(hit => hit.mode),
    ['skip', 'todo', 'only', 'skip'])
})

test('QA #938 BigInt postrepair: signed nonzero literal and computed option keys are detected', () => {
  const code = [
    "import test from 'node:test'",
    "test('negative', { todo: -2n }, () => {})",
    "test('computed key', { ['sk' + 'ip']: 0x10n }, () => {})",
    "test('type assertion is inert in JS test source', { only: -4n }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(code).map(hit => hit.mode),
    ['todo', 'skip', 'only'])
})

test('QA #938 BigInt postrepair: BigInt zeros and literal false remain enabled', () => {
  const code = [
    "import test, { it } from 'node:test'",
    "test('zero decimal', { skip: 0n }, () => {})",
    "test('zero radix', { todo: 0x0n, only: -0n }, () => {})",
    "it('zero binary', { only: 0b0n }, () => {})",
    "test('all false', { skip: false, todo: false, only: false }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(code), [])
})

test('QA #938 BigInt postrepair: namespace and alias disable options are recognized', () => {
  const code = [
    "import * as nodeTest from 'node:test'",
    "import { default as check } from 'node:test'",
    "nodeTest.test('skipped', { skip: 2n }, () => {})",
    "nodeTest['it']('todo', { todo: -3n }, () => {})",
    "check('focused', { only: 100n }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(code).map(hit => hit.mode),
    ['skip', 'todo', 'only'])
})

test('QA #938 BigInt postrepair: dynamic values, unrelated helpers and inert text abstain', () => {
  const code = [
    "import test from 'node:test'",
    "const fromRuntime = 1n",
    "test('dynamic', { skip: fromRuntime }, () => {})",
    "test('dynamic arithmetic', { only: 1n + 0n }, () => {})",
    "anotherTest('foreign', { todo: 1n }, () => {})",
    "test('ordinary case', () => {})",
    "// test('comment only', { only: 1n }, () => {})",
    'const text = "test(\'string only\', { skip: 1n })"',
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(code), [])
})
