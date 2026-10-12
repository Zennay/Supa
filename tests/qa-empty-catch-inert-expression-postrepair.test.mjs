import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Independent assurance on frozen #1919. Parse candidate TS/TSX with the
// real guard, never execute candidate exception handlers or hostile bodies.
const contract = readFileSync(new URL('./production-empty-catch-boundary.test.mjs', import.meta.url), 'utf8')
const begin = contract.indexOf('function scriptKindFor(')
const end = contract.indexOf("\ntest('production source contains", begin)
assert.ok(begin >= 0 && end > begin)
const { findUndocumentedEmptyCatch } = new Function(
  'ts', 'path',
  contract.slice(begin, end) + '\nreturn { findUndocumentedEmptyCatch }',
)(ts, { extname: filename => filename.endsWith('.tsx') ? '.tsx' : '.ts' })

test('QA #1000 independent: bare debugger and nested debugger cannot justify an undocumented catch', () => {
  for (const value of [
    'try { f() } catch { debugger; }',
    'try { f() } catch { ; debugger; ; }',
    'try { f() } catch (error) { { debugger; { ; } } }',
    'try { f() } catch { /* @TODO */ debugger; }',
  ]) assert.ok(findUndocumentedEmptyCatch(value), value)
})

test('QA #1000 independent: all inert literal families and nested parentheses fail closed', () => {
  for (const value of [
    '"ignored"', '0', '12.4', '12n', 'true', 'false', 'null',
    "'txt'", '/pattern/u', '(12)', '((null))', '((42n))',
  ]) {
    const candidate = 'try { f() } catch { ' + value + '; }'
    assert.ok(findUndocumentedEmptyCatch(candidate), candidate)
  }
})

test('QA #1000 independent: static literal chains, nested blocks and lint-only annotations do not count as recovery', () => {
  for (const value of [
    '0; ; false; "text";',
    '{ debugger; { null; ; } }',
    '/* biome-ignore suspicious/noEmptyBlock: skip */ { 1; }',
    '// prettier-ignore\n debugger;',
  ]) {
    const candidate = 'try { f() } catch { ' + value + ' }'
    assert.ok(findUndocumentedEmptyCatch(candidate), candidate)
  }
})

test('QA #1000 independent: genuine potentially-effectful actions and explanatory catches remain permitted', () => {
  for (const value of [
    'handle(error)',
    'obj.property',
    'identifier',
    'obj[index]',
    'counter++',
    '0; handle(error)',
    'debugger; throw error',
    '12; return fallback',
    '/* Storage may be denied; keep data only in memory. */ debugger;',
  ]) {
    const candidate = 'try { f() } catch (error) { ' + value + ' }'
    assert.equal(findUndocumentedEmptyCatch(candidate), null, candidate)
  }
})

test('QA #1000 independent: reports TSX catch source location and first undocumented failure', () => {
  const candidate = [
    'const view = <section>Safe</section>',
    'try { f() } catch { /* Local-only fallback is safe. */ debugger; }',
    'try {',
    '  throw Error("do not run this candidate")',
    '} catch (error) {',
    '  { ; debugger; "ignored"; }',
    '}',
    'try { f() } catch { debugger; }',
  ].join('\n')
  const report = findUndocumentedEmptyCatch(candidate, 'fixture.tsx')
  assert.ok(report)
  assert.equal(report.line, 5)
  assert.match(report.text, /catch \(error\)/)
})
