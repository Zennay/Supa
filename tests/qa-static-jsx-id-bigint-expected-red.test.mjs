import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Red/green contract on the original static JSX-id guard, without mutating
// the existing owner implementation. Literal bigint interpolation is static
// JS string coercion and must not silently evade duplicate-id diagnostics.
const source = readFileSync(
  new URL('./production-static-jsx-id-boundary.test.mjs', import.meta.url), 'utf8',
)
const begin = source.indexOf('function unwrapStaticExpression(')
const end = source.indexOf("\ntest('production TSX contains", begin)
assert.ok(begin >= 0 && end > begin, 'actual AST guard source should be discoverable')
const { duplicateStaticIds } = new Function(
  'ts', source.slice(begin, end) + '\nreturn { duplicateStaticIds }',
)(ts)

test('QA #1006 expected RED: bigint literal string concatenation detects a duplicate HTML id', () => {
  const hits = duplicateStaticIds([
    { filename: 'known.tsx', source: '<label id="item-2" />' },
    { filename: 'bigint.tsx', source: 'const view = <input id={"item-" + 2n} />' },
  ])
  assert.deepEqual(hits.map(hit => hit.id), ['item-2'])
})

test('QA #1006 expected RED: negative bigint template and radix bigint spread retain static identity', () => {
  const tick = String.fromCharCode(96)
  const hits = duplicateStaticIds([
    { filename: 'known.tsx', source: '<><div id="row--2" /><div id="row-16" /></>' },
    {
      filename: 'bigint.tsx',
      source: [
        'const first = <input id={' + tick + 'row-${-2n}' + tick + '} />',
        'const second = <output {...{ id: "row-" + 0x10n }} />',
      ].join('\n'),
    },
  ])
  assert.deepEqual(hits.map(hit => hit.id), ['row--2', 'row-16'])
})

test('QA #1006 expected RED: bigint beyond safe number range retains full exact string identity', () => {
  const hits = duplicateStaticIds([
    { filename: 'exact.tsx', source: '<span id="exact-9007199254740993" />' },
    { filename: 'bigint.tsx', source: 'const x = <input id={"exact-" + 9_007_199_254_740_993n} />' },
  ])
  assert.deepEqual(hits.map(hit => hit.id), ['exact-9007199254740993'])
})

test('QA #1006: dynamic bigint expressions and custom components remain intentionally abstained', () => {
  const hits = duplicateStaticIds([
    { filename: 'known.tsx', source: '<div id="item-2" />' },
    {
      filename: 'dynamic.tsx',
      source: [
        'const a = <input id={"item-" + unknownBigint} />',
        'const b = <input id={"item-" + computeBigint()} />',
        'const c = <CustomField id={"item-" + 2n} />',
        'const d = <CustomField {...{id: "item-" + 2n}} />',
      ].join('\n'),
    },
  ])
  assert.deepEqual(hits, [])
})
