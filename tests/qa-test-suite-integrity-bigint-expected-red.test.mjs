import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Expected-RED on frozen #938 test-suite integrity owner. Execute only the
// ACTUAL TypeScript AST detector extracted from the separate guard test.
const src = readFileSync(new URL('./test-suite-integrity-contract.test.mjs', import.meta.url), 'utf8')
const begin = src.indexOf('function propertyName(')
const end = src.indexOf("\ntest('disabled-test detector catches", begin)
assert.ok(begin > 0 && end > begin)
const { findDisabledNodeTests } = new Function('ts',
  'const disabledModes = new Set(["only", "skip", "todo"]);\n' +
  'const nodeTestExports = new Set(["describe", "it", "suite", "test"]);\n' +
  src.slice(begin, end) + '\nreturn { findDisabledNodeTests };',
)(ts)

test('QA #938 expected RED: nonzero BigInt literal skip option disables node:test coverage', () => {
  const candidate = [
    "import test from 'node:test'",
    "test('silently skipped', { skip: 1n }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(candidate).map(x => x.mode), ['skip'])
})

test('QA #938 expected RED: prefixed and signed BigInt literal options are also truthy', () => {
  const candidate = [
    "import { it, describe } from 'node:test'",
    "it('to do', { todo: 0x10n }, () => {})",
    "describe('focused suite', { only: -1n }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(candidate).map(x => x.mode), ['todo', 'only'])
})

test('QA #938: BigInt zero and explicit false leave tests enabled', () => {
  const candidate = [
    "import test from 'node:test'",
    "test('zero bigint', { skip: 0n, todo: 0x0n, only: -0n }, () => {})",
    "test('false', { skip: false }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(candidate), [])
})

test('QA #938: identifiers, dynamic member keys and unrelated APIs remain ignored', () => {
  const candidate = [
    "import test from 'node:test'",
    "const reason = 1n",
    "test('dynamic', { skip: reason }, () => {})",
    "foreign.test('other API', { skip: 1n }, () => {})",
  ].join('\n')
  assert.deepEqual(findDisabledNodeTests(candidate), [])
})
