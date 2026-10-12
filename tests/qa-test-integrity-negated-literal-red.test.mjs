import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// #938 expected RED: compile-time negation of literal node:test options is
// still a literal truthy skip/todo/only flag. Parsed source only, never run.
const script = readFileSync(new URL('./test-suite-integrity-contract.test.mjs', import.meta.url), 'utf8')
const start = script.indexOf('const disabledModes =')
const end = script.indexOf("\ntest('disabled-test detector catches", start)
assert.ok(start >= 0 && end > start)
const scan = new Function('ts', script.slice(start, end) +
  '\nreturn findDisabledNodeTests')(ts)

test('QA #938 RED: static negated falsey options disable or focus tests', () => {
  const source = [
    "import test from 'node:test'",
    "test('skipped literal false', { skip: !false }, () => {})",
    "test('focused zero', { only: !0 }, () => {})",
    "test('todo empty text', { todo: !'' }, () => {})",
    "test('skipped double true', { skip: !!true }, () => {})",
    "test('focused triple false', { only: !!!false }, () => {})",
  ].join('\n')
  assert.deepEqual(scan(source).map(item => item.mode),
    ['skip', 'only', 'todo', 'skip', 'only'])
})

test('QA #938 positive control: falsy negations and dynamic values are not invented as disabled', () => {
  const source = [
    "import test from 'node:test'",
    "test('normal true', { skip: !true }, () => {})",
    "test('normal double false', { only: !!false }, () => {})",
    "test('normal objects', { todo: !{}, skip: ![] }, () => {})",
    "test('unknown runtime', { skip: !remoteFlag }, () => {})",
    "test('actual disabled', { skip: true }, () => {})",
  ].join('\n')
  assert.deepEqual(scan(source).map(item => item.mode), ['skip'])
})

test('QA #938 RED: negated bigint and regexp literals have deterministic truthiness', () => {
  const source = [
    "import { test as check } from 'node:test'",
    "check('only zero bigint', { only: !0n }, () => {})",
    "check('todo double regex', { todo: !!/required/ }, () => {})",
    "check('not focused nonzero', { only: !12n }, () => {})",
  ].join('\n')
  assert.deepEqual(scan(source).map(item => item.mode), ['only', 'todo'])
})
