import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// QA #1000 independent postrepair proof against the real AST guard.
// TypeScript and TSX fixtures are parsed but never executed.
const body = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const start = body.indexOf('function scriptKindFor(')
const end = body.indexOf("\ntest('production source contains", start)
assert.ok(start >= 0 && end > start)
const find = new Function('ts', 'path',
  body.slice(start, end) + '\nreturn findUndocumentedEmptyCatch'
)(ts, { extname: filename => filename.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1000 independent: erased declarations cannot launder documentation into catch rationale', () => {
  for (const part of [
    'type A = { /* Type shape only, not an exception policy. */ x: number }',
    'interface A { /** Storage data model, not handling. */ x: string }',
    'type A = /* Type-doc context only. */ ReadonlyArray<number>',
    'interface A { // Property docs do not describe a caught failure.\n x: number }',
  ]) {
    const code = `try { risky() } catch { ${part} }`
    const hit = find(code, 'candidate.ts')
    assert.ok(hit, code)
    assert.equal(hit.line, 1)
  }
})

test('QA #1000 independent: nested TSX erased and deferred comments cannot document outer catch', () => {
  const code = [
    'const element = <main>stable</main>;',
    'try { risky() } catch {',
    '  { type A = {',
    '    /* Doc for A only, not error handling. */',
    '    key: string',
    '  } }',
    '  const lazy = () => { /* Deferred fallback never called. */ recover(); };',
    '}',
  ].join('\n')
  const finding = find(code, 'component.tsx')
  assert.ok(finding)
  assert.equal(finding.line, 2)
})

test('QA #1000 independent: adjacent real catch rationale and active handling still count', () => {
  for (const code of [
    'try { risky() } catch { /* Browser storage may fail; keep state in memory. */ type A = { /* Type docs. */ x: number } }',
    'try { risky() } catch { type A = { /* Type docs. */ x: number }; // Browser access denied: use in-memory fallback.\n }',
    'try { risky() } catch { type A = { /* Docs. */ x: number }; fallback.value; }',
    'try { risky() } catch { interface A { x: number } recover(); }',
    'try { risky() } catch { type A = number; throw new Error("failed"); }',
  ]) assert.equal(find(code, 'component.ts'), null, code)
})
