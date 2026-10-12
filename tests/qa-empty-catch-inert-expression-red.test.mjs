import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Synthetic expected-RED against the real frozen #1000 AST guard. Only the
// detector runs; candidate exception handlers are never executed.
const source = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const start = source.indexOf('function scriptKindFor(')
const finish = source.indexOf("\ntest('production source contains", start)
assert.ok(start >= 0 && finish > start, 'real guard must be present')
const { findUndocumentedEmptyCatch } = new Function(
  'ts', 'path',
  source.slice(start, finish) + '\nreturn { findUndocumentedEmptyCatch }',
)(ts, { extname: name => name.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1000 expected RED: bare debugger in catch is not error recovery', () => {
  for (const candidate of [
    'try { save() } catch { debugger; }',
    'try { save() } catch (error) { ; { debugger; } }',
    'try { save() } catch { /* TODO later */ debugger; }',
  ]) {
    assert.ok(findUndocumentedEmptyCatch(candidate), candidate)
  }
})

test('QA #1000 expected RED: literal-only expression statements are not error recovery', () => {
  for (const candidate of [
    'try { save() } catch { "not recovery"; }',
    "try { save() } catch { 42; }",
    'try { save() } catch { true; null; }',
    'try { save() } catch { (("text")); }',
    'try { save() } catch { /*eslint-disable no-empty*/ 0; }',
  ]) {
    assert.ok(findUndocumentedEmptyCatch(candidate), candidate)
  }
})

test('QA #1000 control: explanations, actual recovery and potentially active expressions are preserved', () => {
  for (const candidate of [
    'try { save() } catch { debugger; /* Browser storage denied; recover in memory. */ }',
    'try { save() } catch { "log"; throw Error("save failed") }',
    'try { save() } catch { { 0; return fallback } }',
    'try { save() } catch { report(error) }',
    'try { save() } catch { state.error }',
  ]) {
    assert.equal(findUndocumentedEmptyCatch(candidate), null, candidate)
  }
})
