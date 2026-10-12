import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// Independent QA assurance of #1000 source fix. Only AST inspection executes;
// no sample recovery expression is ever evaluated.
const source = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const start = source.indexOf('function scriptKindFor(')
const end = source.indexOf("\ntest('production source contains", start)
assert.ok(start >= 0 && end > start)
const inspect = new Function(
  'ts', 'path', source.slice(start, end) + '\nreturn findUndocumentedEmptyCatch',
)(ts, { extname: filename => filename.endsWith('.tsx') ? '.tsx' : '.ts' })

const candidate = body => `function f() { try { unsafe() } catch (error) { ${body} } }`

test('QA #1000 independent: defer-only arrows and function bodies never count as recovery', () => {
  for (const code of [
    '(() => { repair(error) });',
    '(async () => repair(error));',
    'void (function deferred() { repair(error) });',
    'function* deferred() { yield repair(error) }',
    'async function deferred() { await repair(error) }',
    '{ function deferred() { repair(error) } }',
    'debugger; void (() => repair(error));',
  ]) {
    assert.ok(inspect(candidate(code)), code)
  }
})

test('QA #1000 independent: explained omission and genuine immediate recovery remain permitted', () => {
  for (const code of [
    '(() => repair(error))();',
    'void (function () { repair(error) })();',
    'async function deferred() { await repair(error) } void deferred();',
    'function* deferred() { yield repair(error) } void deferred().next();',
    'throw new Error("recovery impossible");',
    'return fallback;',
    '/* Ignoring an optional cache refresh is safe in this mode. */ (() => 0);',
  ]) {
    assert.equal(inspect(candidate(code)), null, code)
  }
})

test('QA #1000 independent: lint-only text does not mask delayed calls, with TSX location', () => {
  const code = [
    'const node = <div>ready</div>',
    'try { unsafe() } catch { /* User will keep an in-memory session. */ }',
    'try { unsafe() } catch (error) {',
    '  // eslint-disable-next-line no-empty',
    '  void (() => repair(error));',
    '}',
    'try { unsafe() } catch { (() => repair()); }',
  ].join('\n')
  const found = inspect(code, 'fixture.tsx')
  assert.ok(found)
  assert.equal(found.line, 3)
  assert.match(found.text, /catch \(error\)/)
})
