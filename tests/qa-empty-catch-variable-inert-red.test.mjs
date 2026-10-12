import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// QA #1000 expected RED: the actual production-source guard, never run the
// synthetic code snippets. Variable binding alone does not handle a failure.
const source = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const start = source.indexOf('function scriptKindFor(')
const end = source.indexOf("\ntest('production source contains", start)
assert.ok(start >= 0 && end > start)
const inspect = new Function('ts', 'path',
  source.slice(start, end) + '\nreturn findUndocumentedEmptyCatch',
)(ts, { extname: name => name.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1000 RED: ordinary variable declarations do not recover from an exception', () => {
  for (const body of [
    'const acknowledged = true;',
    'let ignored;',
    'var snapshot = null;',
    'const code = 42, marker = "checked";',
    'const regexp = /optional-store/;',
    'let empty = void (0);',
    'const lazy = () => recover();',
    'const deferred = function () { retry() };',
  ]) {
    const script = `try { risky() } catch { ${body} }`
    assert.ok(inspect(script), script)
  }
})

test('QA #1000 RED: comment nested in an uninvoked declared callback does not excuse an empty catch', () => {
  const source = [
    'try { risky() } catch {',
    '  const later = () => {',
    '    /* Browser storage may be unavailable. */',
    '    recover();',
    '  };',
    '}',
  ].join('\n')
  const finding = inspect(source)
  assert.ok(finding, 'declaration and nested rationale never execute')
  assert.equal(finding.line, 1)
})

test('QA #1000 control: real initializers, binding side effects, and explicit commentary stay valid', () => {
  for (const script of [
    'try { risky() } catch { const result = recover(); }',
    'try { risky() } catch { const current = service.value; }',
    'try { risky() } catch { const { value } = recover(); }',
    'try { risky() } catch { const [value] = iterable; }',
    'try { risky() } catch { const ignored = 0; /* Failed optional storage leaves session in memory. */ }',
    'try { risky() } catch { const ignored = 0; throw new Error("failure"); }',
  ]) assert.equal(inspect(script), null, script)
})

test('QA #1000 control: unrelated nested catches retain their own location', () => {
  const code = [
    'try { risky() } catch {',
    '  const retained = recover();',
    '  try { riskyAgain() } catch { const noop = 1; }',
    '}',
  ].join('\n')
  const finding = inspect(code, 'fixture.tsx')
  assert.ok(finding, 'nested useless declaration must remain discoverable')
  assert.equal(finding.line, 3)
})
