import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// QA #938 hypothesis/expected-RED: JavaScript numeric separators are syntax,
// not part of the value; inspect the actual guard AST without executing fixtures.
const text = readFileSync(new URL('./test-suite-integrity-contract.test.mjs', import.meta.url), 'utf8')
const start = text.indexOf('const disabledModes =')
const end = text.indexOf("\ntest('disabled-test detector catches", start)
assert.ok(start >= 0 && end > start)
const scan = new Function('ts', text.slice(start, end) + '\nreturn findDisabledNodeTests')(ts)

test('QA #938: separated zero literals may not be interpreted as truthy flags', () => {
  const input = [
    "import test from 'node:test'",
    "test('zero decimal', { skip: 0.0_0 }, () => {})",
    "test('zero hex', { todo: 0x0_0 }, () => {})",
    "test('zero binary', { only: 0b0_0 }, () => {})",
    "test('nonzero positive control', { skip: 1_0 }, () => {})",
  ].join('\n')
  assert.deepEqual(scan(input).map(hit => hit.mode), ['skip'])
})

test('QA #938: negated separated zero must become true and even-negated zero false', () => {
  const input = [
    "import { test as check } from 'node:test'",
    "check('not zero', { only: !0.0_0 }, () => {})",
    "check('not hex zero', { todo: !(0x0_0) }, () => {})",
    "check('double zero', { skip: !!0b0_0 }, () => {})",
    "check('nonzero', { todo: !!1_0 }, () => {})",
  ].join('\n')
  assert.deepEqual(scan(input).map(hit => hit.mode), ['only', 'todo', 'todo'])
})

test('QA #938: signed separated numbers and dynamic properties never execute', () => {
  const input = [
    "import * as tests from 'node:test'",
    "tests.test('signed zero', { skip: !(-0.0_0) }, () => {})",
    "tests.test('signed bigint zero', { todo: !(-0x0_0n) }, () => {})",
    "tests.test('signed nonzero', { only: !!(-1_0) }, () => {})",
    "tests.test('unknown', { skip: !(-remote.flag) }, () => {})",
  ].join('\n')
  assert.deepEqual(scan(input).map(hit => hit.mode), ['skip', 'todo', 'only'])
})
