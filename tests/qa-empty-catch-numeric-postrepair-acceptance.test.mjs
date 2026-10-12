import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import * as ts from 'typescript'

// Separate postrepair acceptance: call the actual QA AST guard without making
// the owning test file export implementation details. All fixtures are inert.
const source = readFileSync(
  new URL('./production-empty-catch-boundary.test.mjs', import.meta.url),
  'utf8',
)
const start = source.indexOf('function scriptKindFor(')
const end = source.indexOf("\ntest('production source contains", start)
assert.ok(start >= 0 && end > start)
const scan = new Function(
  'ts', 'path',
  source.slice(start, end) + '\nreturn findUndocumentedEmptyCatch',
)(ts, path)

function emptyCatch(comment, filename = 'fixture.ts') {
  return scan(`try { work() } catch { ${comment} }`, filename)
}

test('QA #1000: ASCII and Unicode number-only catch remarks remain undocumented', () => {
  for (const comment of [
    '/* 000000 */',
    '/* 12 345 */',
    '/* ١٢٣٤ */',
    '/* १२३४ */',
    '// 777\n',
    '/* 20-26 */',
    '/* ✅ 2026 */',
    '/* 𝟙𝟚𝟛 */',
  ]) {
    assert.ok(emptyCatch(comment), comment)
  }
})

test('QA #1000: multilingual meaningful explanatory catches are preserved', () => {
  for (const comment of [
    '/* Failed browser storage; keep working in memory. */',
    '/* Opslag is uitgeschakeld door privémodus. */',
    '/* حفظ البيانات غير متاح في هذا الوضع */',
    '/* データ保存は現在利用できません */',
    '/* Αποθήκευση δεδομένων δεν είναι διαθέσιμη */',
  ]) {
    assert.equal(emptyCatch(comment), null, comment)
  }
})

test('QA #1000: an unrelated number or TODO does not defeat another genuine rationale', () => {
  const source = [
    'try { work() } catch {',
    '  /* 500 */',
    '  /* @TODO: update docs */',
    '  // Browser denied localStorage, continue without persisting.',
    '}',
  ].join('\n')
  assert.equal(scan(source, 'nested.tsx'), null)
})

test('QA #1000: nested numeric-only clause reports its own line and not outer handled catch', () => {
  const source = [
    'function load() {',
    '  try {',
    '    try { read() } catch { /* 429 */ }',
    '  } catch (error) { return fallback() }',
    '}',
  ].join('\n')
  const problem = scan(source, 'nested.ts')
  assert.ok(problem)
  assert.equal(problem.line, 3)
  assert.ok(problem.text.includes('429'))
})

test('QA #1000: comment-looking literals are not interpreted as catch clauses', () => {
  const source = [
    'const explanation = "catch { /* 999 */ }"',
    'function load() {',
    '  try { work() } catch { return fallback() }',
    '}',
  ].join('\n')
  assert.equal(scan(source, 'fixture.ts'), null)
})

test('QA #1000: a real catch statement stays valid without any explanatory comment', () => {
  for (const body of ['throw error', 'return fallback()', 'continue']) {
    const src = `while (true) { try { risky() } catch (error) { ${body} } break }`
    assert.equal(scan(src, 'fixture.ts'), null)
  }
})
