import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// QA #938 independent postrepair acceptance against the production test guard.
// Never execute generated fixture code; parse only. Do not bypass test gates.
const guard = readFileSync(new URL('./test-suite-integrity-contract.test.mjs', import.meta.url), 'utf8')
const begin = guard.indexOf('const disabledModes =')
const end = guard.indexOf("\ntest('disabled-test detector catches", begin)
assert.ok(begin >= 0 && end > begin)
const find = new Function('ts', guard.slice(begin, end) +
  '\nreturn findDisabledNodeTests')(ts)

test('QA #938 independent: odd and even logical negations respect actual literal truthiness', () => {
  const fixture = [
    "import test from 'node:test'",
    "test('one', { only: !false }, () => {})",
    "test('two', { skip: !!true }, () => {})",
    "test('three', { todo: !!!false }, () => {})",
    "test('four', { only: !true }, () => {})",
    "test('five', { skip: !!false }, () => {})",
    "test('six', { only: !0 }, () => {})",
    "test('seven', { only: !1 }, () => {})",
    "test('eight', { todo: !'' }, () => {})",
    "test('nine', { todo: !'nonempty' }, () => {})",
  ].join('\n')
  assert.deepEqual(find(fixture).map(entry => entry.mode),
    ['only', 'skip', 'todo', 'only', 'todo'])
})

test('QA #938 independent: literal arrays, objects, regexp and BigInt remain truthy after even negations', () => {
  const fixture = [
    "import * as tests from 'node:test'",
    "tests.test('array', { skip: !![] }, () => {})",
    "tests.it('object', { todo: !!{} }, () => {})",
    "tests.describe('regex', { only: !!/yes/ }, () => {})",
    "tests.test('bigint', { skip: !0n }, () => {})",
    "tests.test('false arrays', { skip: ![] }, () => {})",
    "tests.test('false objects', { only: !{} }, () => {})",
    "tests.test('false regex', { todo: !/regex/ }, () => {})",
    "tests.test('nonzero bigint', { only: !15n }, () => {})",
  ].join('\n')
  assert.deepEqual(find(fixture).map(entry => entry.mode), ['skip', 'todo', 'only', 'skip'])
})

test('QA #938 independent: unknown dynamic expressions are never evaluated or guessed', () => {
  const fixture = [
    "import { test } from 'node:test'",
    "test('value', { skip: !remoteValue }, () => {})",
    "test('call', { todo: !!shouldSkip() }, () => {})",
    "test('getter', { only: !settings.enabled }, () => {})",
    "test('computed', { skip: !!(pending + 1) }, () => {})",
    "test('different API', { skip: !false }, () => {})",
  ].join('\n')
  const records = find(fixture)
  assert.deepEqual(records.map(entry => entry.mode), ['skip'])
  assert.match(records[0].text, /different API/)
})

test('QA #938 independent: nested aliases preserve exact source-line diagnostics', () => {
  const code = [
    "import { describe as group } from 'node:test'",
    "const safe = 'never run'",
    "group('disabled', { ['sk' + 'ip']: !!!false }, () => {})",
  ].join('\n')
  const hit = find(code, 'candidate.test.mjs')
  assert.equal(hit.length, 1)
  assert.equal(hit[0].mode, 'skip')
  assert.equal(hit[0].line, 3)
})
