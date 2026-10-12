import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// Synthetic quality-validation #938: exercise the actual repository guard AST.
// Fixture strings are parsed but NEVER evaluated or invoked.
const guard = readFileSync(new URL('./test-suite-integrity-contract.test.mjs', import.meta.url), 'utf8')
const begin = guard.indexOf('const disabledModes =')
const end = guard.indexOf("\ntest('disabled-test detector catches", begin)
assert.ok(begin >= 0 && end > begin)
const inspect = new Function('ts', guard.slice(begin, end) + '\nreturn findDisabledNodeTests')(ts)

test('QA #938 expected RED: truthy signed numeric literals remain detectable inside ! chains', () => {
  const input = [
    "import test from 'node:test'",
    "test('signed negative', { only: !!(-1) }, () => {})",
    "test('negative zero', { skip: !(-0) }, () => {})",
    "test('positive zero triple', { todo: !!!(+0) }, () => {})",
    "test('negative bigint', { skip: !!(-2n) }, () => {})",
    "test('bigint negative zero', { only: !(-0n) }, () => {})",
  ].join('\n')
  assert.deepEqual(inspect(input).map(hit => hit.mode),
    ['only', 'skip', 'todo', 'skip', 'only'])
})

test('QA #938 expected RED: signed numeric falsy controls are excluded but signed true cases detected', () => {
  const input = [
    "import { test as spec } from 'node:test'",
    "spec('zero double', { only: !!(+0) }, () => {})",
    "spec('nonzero negated', { skip: !(-7) }, () => {})",
    "spec('nonzero bigint negated', { todo: !(-3n) }, () => {})",
    "spec('negative zero even', { only: !!(-0n) }, () => {})",
    "spec('signed positive', { todo: !!(+7) }, () => {})",
    "spec('negative numeric truth', { only: !!(-3.5) }, () => {})",
  ].join('\n')
  assert.deepEqual(inspect(input).map(hit => hit.mode), ['todo', 'only'])
})

test('QA #938 negative control: unknown signed runtime values are never executed or inferred', () => {
  const input = [
    "import test from 'node:test'",
    "test('unknown identifier', { skip: !(-remoteFlag) }, () => {})",
    "test('unknown getter', { only: !!(+config.mode) }, () => {})",
    "test('unknown call', { todo: !(-getValue()) }, () => {})",
    "test('known unrelated', { skip: !(-0) }, () => {})",
  ].join('\n')
  const findings = inspect(input)
  // Dynamic operands stay unknown; a literal control is independently inspectable.
  assert.deepEqual(findings.map(hit => hit.mode), ['skip'])
  assert.equal(findings[0].line, 5)
})
