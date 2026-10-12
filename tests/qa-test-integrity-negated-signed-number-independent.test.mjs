import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// Separate, postrepair QA #938 acceptance; generated source is parsed only.
// Exercise the actual repository test guard, not a copied implementation.
const source = readFileSync(new URL('./test-suite-integrity-contract.test.mjs', import.meta.url), 'utf8')
const begin = source.indexOf('const disabledModes =')
const end = source.indexOf("\ntest('disabled-test detector catches", begin)
assert.ok(begin >= 0 && end > begin)
const inspect = new Function('ts', source.slice(begin, end) + '\nreturn findDisabledNodeTests')(ts)

test('QA #938 independent: signed negative-zero across Number and BigInt disables only when negation is truthy', () => {
  const fixture = [
    "import { test } from 'node:test'",
    "test('negative zero', { skip: !(-0) }, () => {})",
    "test('positive zero', { only: !!!(+0.0) }, () => {})",
    "test('bigint zero', { todo: !(-0n) }, () => {})",
    "test('bigint even', { only: !!(-0n) }, () => {})",
    "test('number even', { skip: !!(-0) }, () => {})",
  ].join('\n')
  assert.deepEqual(inspect(fixture).map(hit => hit.mode), ['skip', 'only', 'todo'])
})

test('QA #938 independent: nested signed nonzero literals and bigint radix remain truthy only on even ! chains', () => {
  const fixture = [
    "import * as nodeTest from 'node:test'",
    "nodeTest.test('negative float', { only: !!(-1e-30) }, () => {})",
    "nodeTest.it('negative hexadecimal bigint', { skip: !!(-0x1fn) }, () => {})",
    "nodeTest.describe('four negations', { todo: !!!!(-2) }, () => {})",
    "nodeTest.test('single negation false', { skip: !(-2n) }, () => {})",
    "nodeTest.test('signed positive nonzero false', { only: !(+4) }, () => {})",
    "nodeTest.test('signed positive nonzero true', { todo: !!(+4) }, () => {})",
  ].join('\n')
  assert.deepEqual(inspect(fixture).map(hit => hit.mode), ['only', 'skip', 'todo', 'todo'])
})

test('QA #938 independent: unknown signed expressions and invalid positive BigInt remain untrusted', () => {
  const fixture = [
    "import test from 'node:test'",
    "test('call', { only: !!(-fetchFlags()) }, () => {})",
    "test('getter', { todo: !(-remote.flags) }, () => {})",
    "test('positive bigint is invalid runtime syntax', { skip: !!(+1n) }, () => {})",
    "test('known literal', { only: !(-0n) }, () => {})",
  ].join('\n')
  const results = inspect(fixture)
  assert.deepEqual(results.map(hit => hit.mode), ['only'])
  assert.equal(results[0].line, 5)
  assert.match(results[0].text, /known literal/)
})
