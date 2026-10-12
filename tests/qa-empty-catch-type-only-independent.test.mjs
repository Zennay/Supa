import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// Independent postrepair QA #1000: parse synthetic TS/TSX without executing it.
const file = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const start = file.indexOf('function scriptKindFor(')
const end = file.indexOf("\ntest('production source contains", start)
assert.ok(start >= 0 && end > start)
const find = new Function('ts', 'path',
  file.slice(start, end) + '\nreturn findUndocumentedEmptyCatch'
)(ts, { extname: filename => filename.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1000 independent: erased aliases and interfaces alone never document a catch', () => {
  for (const body of [
    'type Marker = never;',
    'interface Marker { readonly message: string }',
    'type Marker = typeof globalThis;',
    'type A = number; interface B { value: A }',
    '{ type Deep = { readonly ok: true }; }',
  ]) {
    const src = `try { risky() } catch { ${body} }`
    const found = find(src, 'component.ts')
    assert.ok(found, src)
    assert.equal(found.line, 1)
  }
})

test('QA #1000 independent: actual TSX nesting retains accurate catch location and no phantom runtime recovery', () => {
  const src = [
    'const element = <section>plan</section>;',
    'function save() {',
    '  try { risky() } catch {',
    '    type RuntimeFree = { readonly key: string };',
    '    { interface Inner { ready: boolean } }',
    '    const deferred = () => recover();',
    '  }',
    '}',
  ].join('\n')
  const found = find(src, 'component.tsx')
  assert.ok(found)
  assert.equal(found.line, 3)
  assert.match(found.text, /RuntimeFree/)
})

test('QA #1000 independent: active handling and genuine catch explanation remain accepted', () => {
  const accepted = [
    'try { risky() } catch { type Local = string; recover(); }',
    'try { risky() } catch { interface Local { x: number } throw Error("bad"); }',
    'try { risky() } catch { type Local = number; const x = fallback.value; }',
    'try { risky() } catch { type Local = number; const {value} = fallback; }',
    'try { risky() } catch { type Local = number; /* Optional storage denied, continue with in-memory state. */ }',
  ]
  for (const src of accepted) assert.equal(find(src, 'component.ts'), null, src)
})
