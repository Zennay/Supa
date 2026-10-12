import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// QA #1000 separate postrepair acceptance using the actual guard AST.
// Source snippets are parsed, not executed; never treat these as runtime proof.
const file = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const start = file.indexOf('function scriptKindFor(')
const end = file.indexOf("\ntest('production source contains", start)
assert.ok(start >= 0 && end > start)
const inspect = new Function('ts', 'path',
  file.slice(start, end) + '\nreturn findUndocumentedEmptyCatch',
)(ts, { extname: filename => filename.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1000 independent: pure local declarations do not document or handle a catch', () => {
  const inert = [
    'let local;', 'var local = 0;', 'const local = true;',
    'const local = null;', 'const local = "ignored";',
    'const local = `ignored`;', 'const local = /ignored/;',
    'const local = (42);', 'const local = void 0;',
    'const lazy = () => recover();',
    'const deferred = function () { recover(); };',
    'let first = 0, second = `noop`, third;',
  ]
  for (const body of inert) {
    const code = `try { risky() } catch { ${body} }`
    assert.ok(inspect(code), code)
  }
})

test('QA #1000 independent: one active initializer must keep a mixed declaration effective', () => {
  const effects = [
    'const one = 0, two = recover();',
    'let one, two = fallback.value;',
    'const one = null, { value } = external;',
    'const [item] = tokens;',
    'const { key } = { key: 1 };',
    'const x = recover();',
    'const x = someGlobal;',
    'const x = new Error("unavailable");',
    'const x = `count: ${recover()}`;',
  ]
  for (const body of effects) {
    const code = `try { risky() } catch { ${body} }`
    assert.equal(inspect(code), null, code)
  }
})

test('QA #1000 independent: actual catch-level explanation, throw and return remain accepted', () => {
  const bodies = [
    'const lazy = () => recover(); /* The session keeps state locally after denied storage. */',
    'let unused; // Optional browser storage can be unavailable.\n',
    'const n = 0; throw Error("not recoverable");',
    'const n = 0; return fallback;',
    'const n = 0; recover();',
  ]
  for (const body of bodies) {
    const code = `function attempt() { try { risky() } catch { ${body} } }`
    assert.equal(inspect(code), null, code)
  }
})

test('QA #1000 independent: nested deferred comment is not rationale for outer inert catch', () => {
  const code = [
    'const view = <div>ready</div>;',
    'try { risky() } catch {',
    '  const deferred = () => {',
    '    /* Private-mode persistence is best-effort. */',
    '    return recover();',
    '  };',
    '  const flag = 1;',
    '}',
  ].join('\n')
  const finding = inspect(code, 'component.tsx')
  assert.ok(finding)
  assert.equal(finding.line, 2)
  assert.match(finding.text, /const deferred/)
})

test('QA #1000 independent: only nested inert catch is reported, not recovering outer catch', () => {
  const code = [
    'try { risky() } catch {',
    '  recover();',
    '  try { other() } catch {',
    '    const marker = `ignored`;',
    '  }',
    '}',
  ].join('\n')
  const finding = inspect(code)
  assert.ok(finding)
  assert.equal(finding.line, 3)
})
