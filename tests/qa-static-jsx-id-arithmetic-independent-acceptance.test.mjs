import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// QA-only independent postrepair of the real TSX static-id AST evaluator.
const source = readFileSync(new URL('./production-static-jsx-id-boundary.test.mjs', import.meta.url), 'utf8')
const begin = source.indexOf('function unwrapStaticExpression(')
const end = source.indexOf("\ntest('production TSX contains", begin)
assert.ok(begin >= 0 && end > begin)
const { duplicateStaticIds, collectStaticIntrinsicIds } = new Function(
  'ts', source.slice(begin, end) +
  '\nreturn { duplicateStaticIds, collectStaticIntrinsicIds }',
)(ts)

test('QA #1006 arithmetic postrepair: nested left/right number additions preserve JS precedence', () => {
  const hits = duplicateStaticIds([
    { filename: 'literal.tsx', source: '<div id="count-6"/>' },
    { filename: 'derived.tsx', source: [
      'const x = <input id={"count-" + (1 + 2 + 3)} />',
      'const y = <input id={"count-" + (1 + (2 + 3))} />',
    ].join('\n') },
  ])
  assert.deepEqual(hits.map(x => x.id), ['count-6', 'count-6'])
})

test('QA #1006 arithmetic postrepair: typed radix numbers and fractional JS sums are exact', () => {
  const hits = duplicateStaticIds([
    { filename: 'literal.tsx', source: '<><label id="hex-21"/><label id="fraction-0.30000000000000004"/></>' },
    { filename: 'derived.tsx', source: [
      'const x = <input id={"hex-" + ((0x10 + 0b101) satisfies number)} />',
      'const y = <input id={"fraction-" + (0.1 + 0.2)} />',
    ].join('\n') },
  ])
  assert.deepEqual(hits.map(x => x.id), ['hex-21', 'fraction-0.30000000000000004'])
})

test('QA #1006 arithmetic postrepair: BigInt arithmetic keeps exact unrounded values', () => {
  const hits = duplicateStaticIds([
    { filename: 'literal.tsx', source: '<label id="exact-9007199254741000"/>' },
    { filename: 'derived.tsx', source: '<input id={"exact-" + (9007199254740993n + 7n)} />' },
  ])
  assert.deepEqual(hits.map(x => x.id), ['exact-9007199254741000'])
})

test('QA #1006 arithmetic postrepair: string-before-number concatenation remains left associative', () => {
  const hits = duplicateStaticIds([
    { filename: 'literal.tsx', source: '<div id="choice-123"/>' },
    { filename: 'derived.tsx', source: '<input id={"choice-" + 1 + 2 + 3} />' },
  ])
  assert.deepEqual(hits.map(x => x.id), ['choice-123'])
})

test('QA #1006 arithmetic postrepair: mixed-number/BigInt and unary-plus BigInt abstain', () => {
  const hits = duplicateStaticIds([
    { filename: 'literal.tsx', source: '<div id="guess-12"/>' },
    { filename: 'invalid.tsx', source: [
      'const mixed = <input id={"guess-" + (1n + 2)} />',
      'const unary = <input id={"guess-" + (+12n)} />',
      'const runtime = <input id={"guess-" + (runtime + 2)} />',
      'const custom = <Component id={"guess-" + (1 + 2)} />',
    ].join('\n') },
  ])
  assert.deepEqual(hits, [])
})

test('QA #1006 arithmetic postrepair: computed numeric id retains source-line diagnostics', () => {
  const ids = collectStaticIntrinsicIds([
    'const page = (',
    '  <article>',
    '    <label htmlFor="counter">Counter</label>',
    '    <input id={"count-" + (2 + 5)} />',
    '  </article>',
    ')',
  ].join('\n'), 'arithmetic.tsx')
  assert.deepEqual(ids, [{ id: 'count-7', line: 4, column: 12 }])
})
