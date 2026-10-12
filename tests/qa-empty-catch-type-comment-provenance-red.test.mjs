import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// QA #1000 synthetic expected-RED for comment provenance.
// All fixtures parsed with the actual AST guard; none are executed.
const guard = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const start = guard.indexOf('function scriptKindFor(')
const end = guard.indexOf("\ntest('production source contains", start)
assert.ok(start >= 0 && end > start)
const find = new Function('ts', 'path',
  guard.slice(start, end) + '\nreturn findUndocumentedEmptyCatch'
)(ts, { extname: filename => filename.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1000 expected RED: documentation INSIDE erased type declarations is not catch rationale', () => {
  for (const typeBody of [
    'type Local = { /* A saved value could be unavailable. */ value: string };',
    'interface Local { /** Document the optional storage state. */ value: number }',
    'type Local = /* Type-level output contract only. */ number;',
    'interface Local { // This describes a type, not a recovery.\n optional?: boolean }',
  ]) {
    const src = `try { risky() } catch { ${typeBody} }`
    const hit = find(src, 'example.ts')
    assert.ok(hit, src)
    assert.equal(hit.line, 1)
  }
})

test('QA #1000 expected RED: nested TSX type docs cannot excuse an outer silent catch', () => {
  const src = [
    'const view = <span>ready</span>;',
    'try { risky() } catch {',
    '  { type Internal = {',
    '    /** Only type information, not recovery. */',
    '    value: string',
    '  }; }',
    '}',
  ].join('\n')
  const hit = find(src, 'component.tsx')
  assert.ok(hit)
  assert.equal(hit.line, 2)
})

test('QA #1000 control: genuinely catch-level explanation or active recovery stays valid', () => {
  for (const src of [
    'try { risky() } catch { type Local = { /* type docs */ value: string }; /* Ignore inaccessible browser storage and use session state. */ }',
    'try { risky() } catch { // Optional storage may fail; use in-memory state.\n type Local = string; }',
    'try { risky() } catch { type Local = { /* docs */ id: string }; recover(); }',
    'try { risky() } catch { interface Local { value: number } throw Error("no recovery"); }',
  ]) assert.equal(find(src, 'example.ts'), null, src)
})
