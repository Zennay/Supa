import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// QA #1000 expected-RED: these TypeScript declarations are erased at runtime.
// The fixtures are parsed as AST only; no sample code is ever executed.
const guard = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const start = guard.indexOf('function scriptKindFor(')
const end = guard.indexOf("\ntest('production source contains", start)
assert.ok(start >= 0 && end > start)
const inspect = new Function('ts', 'path',
  guard.slice(start, end) + '\nreturn findUndocumentedEmptyCatch'
)(ts, { extname: filename => filename.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1000 expected RED: type-only catch declarations do not handle errors at runtime', () => {
  const inert = [
    'type Local = string;',
    'type Status = { ok: boolean };',
    'interface Local { value: string }',
    'type One = string; type Two = number;',
    'interface Local { value: string }; type Extra = never;',
  ]
  for (const statement of inert) {
    const code = `try { risky() } catch { ${statement} }`
    const hit = inspect(code, 'candidate.ts')
    assert.ok(hit, code)
    assert.equal(hit.line, 1)
  }
})

test('QA #1000 expected RED: nested TS type-only blocks remain ineffective in TSX catches', () => {
  const fixture = [
    'const output = <div>ready</div>;',
    'try { risky() } catch {',
    '  { type Extra = { state: number }; }',
    '  type Deferred = () => void;',
    '  interface Hint { label: string }',
    '}',
  ].join('\n')
  const hit = inspect(fixture, 'widget.tsx')
  assert.ok(hit)
  assert.equal(hit.line, 2)
})

test('QA #1000 positive controls: actual recovery and genuine rationale remain accepted next to types', () => {
  const accepted = [
    'try { risky() } catch { type Local = string; recover(); }',
    'try { risky() } catch { interface Context { x: number }; throw Error("no storage"); }',
    'try { risky() } catch { type Local = string; /* Browser storage unavailable; in-memory fallback. */ }',
    'try { risky() } catch { type Local = string; const data = fallback.value; }',
  ]
  for (const code of accepted) assert.equal(inspect(code, 'candidate.ts'), null, code)
})
