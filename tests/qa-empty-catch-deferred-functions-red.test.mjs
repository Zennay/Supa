import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// QA #1000: static-only synthetic fixtures; candidate scripts are parsed,
// never evaluated or invoked. This is an expected-RED test-only branch.
const source = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const start = source.indexOf('function scriptKindFor(')
const end = source.indexOf("\ntest('production source contains", start)
assert.ok(start >= 0 && end > start)
const inspect = new Function(
  'ts', 'path', source.slice(start, end) + '\nreturn findUndocumentedEmptyCatch',
)(ts, { extname: file => file.endsWith('.tsx') ? '.tsx' : '.ts' })

function caught(statement) {
  return 'function check() { try { risky() } catch (error) { ' + statement + ' } }'
}

test('QA #1000 RED: creating an uncalled arrow or function expression is not recovery', () => {
  for (const body of [
    '() => recover(error);',
    '(() => { recover(error) });',
    'void (() => recover(error));',
    '!(() => recover(error));',
    '(function deferred() { recover(error) });',
    'debugger; void (async () => recover(error));',
  ]) {
    assert.ok(inspect(caught(body)), body)
  }
})

test('QA #1000 RED: merely declaring a local function does not handle caught errors', () => {
  for (const body of [
    'function deferred() { recover(error) }',
    'async function deferred() { await recover(error) }',
    '{ function deferred() { recover(error) } }',
    '/* eslint-disable no-empty */ function deferred() { recover(error) }',
  ]) {
    assert.ok(inspect(caught(body)), body)
  }
})

test('QA #1000 positive: executing recovery still counts, and explicit rationale remains allowed', () => {
  for (const body of [
    '(() => recover(error))();',
    '(function () { recover(error) })();',
    'void (() => recover(error))();',
    'function deferred() { recover(error) } deferred();',
    'throw error;',
    'return fallback;',
  ]) {
    assert.equal(inspect(caught(body)), null, body)
  }
  assert.equal(
    inspect(caught('/* This optional cache can be skipped after a read failure. */ () => 1;')),
    null,
  )
})
