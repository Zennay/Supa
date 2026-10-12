import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Expected-RED proof of JS addition precedence in STATIC JSX id expressions.
// The actual frozen guard is extracted; no production code or owner branch edits.
const source = readFileSync(new URL('./production-static-jsx-id-boundary.test.mjs', import.meta.url), 'utf8')
const begin = source.indexOf('function unwrapStaticExpression(')
const end = source.indexOf("\ntest('production TSX contains", begin)
assert.ok(begin >= 0 && end > begin)
const { duplicateStaticIds } = new Function(
  'ts', source.slice(begin, end) + '\nreturn { duplicateStaticIds }',
)(ts)

test('QA #1006 expected RED: nested numeric literal addition is arithmetic before string concatenation', () => {
  const duplicates = duplicateStaticIds([
    { filename: 'literal.tsx', source: '<div id="sum-3" />' },
    { filename: 'derived.tsx', source: '<input id={"sum-" + (1 + 2)} />' },
  ])
  assert.deepEqual(duplicates.map(entry => entry.id), ['sum-3'])
})

test('QA #1006 expected RED: numerical template interpolation uses arithmetic value', () => {
  const tick = String.fromCharCode(96)
  const duplicates = duplicateStaticIds([
    { filename: 'literal.tsx', source: '<div id="week-7" />' },
    { filename: 'derived.tsx', source: 'const x = <input id={' + tick + 'week-${(3 + 4)}' + tick + '} />' },
  ])
  assert.deepEqual(duplicates.map(entry => entry.id), ['week-7'])
})

test('QA #1006 expected RED: bigint addition is exact before conversion to text', () => {
  const duplicates = duplicateStaticIds([
    { filename: 'literal.tsx', source: '<div id="large-9007199254740994" />' },
    {
      filename: 'derived.tsx',
      source: 'const x = <output id={"large-" + (9007199254740993n + 1n)} />',
    },
  ])
  assert.deepEqual(duplicates.map(entry => entry.id), ['large-9007199254740994'])
})

test('QA #1006 expected RED: mixed Number+BigInt arithmetic is not a valid static id', () => {
  const duplicates = duplicateStaticIds([
    { filename: 'literal.tsx', source: '<div id="wrong-12" />' },
    { filename: 'invalid.tsx', source: 'const x = <output id={"wrong-" + (1n + 2)} />' },
  ])
  assert.deepEqual(duplicates, [])
})

test('QA #1006: left-to-right string concatenation remains valid and dynamic IDs abstain', () => {
  const duplicates = duplicateStaticIds([
    { filename: 'literal.tsx', source: '<div id="sum-12" />' },
    { filename: 'derived.tsx', source: [
      'const first = <input id={"sum-" + 1 + 2} />',
      'const dynamic = <input id={"sum-" + runtimeNumber} />',
      'const custom = <Custom id={"sum-" + (1 + 2)} />',
    ].join('\n') },
  ])
  assert.deepEqual(duplicates.map(entry => entry.id), ['sum-12'])
})
