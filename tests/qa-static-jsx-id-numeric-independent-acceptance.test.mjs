import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Independent acceptance for the frozen #1006 QA guard. Reuse the actual
// implementation (without exporting internal test helpers or editing owner
// files), rather than reimplementing its AST traversal in this test.
const source = readFileSync(
  new URL('./production-static-jsx-id-boundary.test.mjs', import.meta.url),
  'utf8',
)
const start = source.indexOf('function unwrapStaticExpression(')
const end = source.indexOf("\ntest('production TSX contains", start)
assert.ok(start >= 0 && end > start, 'frozen QA parser contract must be discoverable')
const { collectStaticIntrinsicIds, duplicateStaticIds } = new Function(
  'ts',
  source.slice(start, end) + '\nreturn { collectStaticIntrinsicIds, duplicateStaticIds }',
)(ts)

test('QA #1006: numeric radix, separators and minus-zero collide with equivalent literal DOM ids', () => {
  const duplicates = duplicateStaticIds([
    {
      filename: 'plain.tsx',
      source: '<><div id="slot-8"/><div id="slot-10"/><div id="slot-1024"/><div id="slot-0"/></>',
    },
    {
      filename: 'computed.tsx',
      source: [
        'const ui = <>',
        '  <input id={"slot-" + 0b1000} />',
        '  <span id={`slot-${0o12}`} />',
        '  <output {...{ id: "slot-" + 1_024 }} />',
        '  <label id={"slot-" + (-0)} />',
        '</>',
      ].join('\n'),
    },
  ])
  assert.deepEqual(duplicates.map(hit => hit.id),
    ['slot-8', 'slot-10', 'slot-1024', 'slot-0'])
  assert.ok(duplicates.every(hit => hit.first.filename === 'plain.tsx'))
  assert.ok(duplicates.every(hit => hit.duplicate.filename === 'computed.tsx'))
})

test('QA #1006: nested template, prefix unary and typed constant expressions are statically detected', () => {
  const duplicates = duplicateStaticIds([
    {
      filename: 'literal.tsx',
      source: '<><div id="choice--3" /><div id="choice-2" /><div id="choice-12" /></>',
    },
    {
      filename: 'calculated.tsx',
      source: [
        'const a = <input id={`choice-${(-3 as number)}`} />',
        'const b = <input id={("choice-" + (+2)) satisfies string} />',
        'const c = <span {...{ ["id"]: "choice-" + (0xC!) }} />',
      ].join('\n'),
    },
  ])
  assert.deepEqual(duplicates.map(hit => hit.id), ['choice--3', 'choice-2', 'choice-12'])
})

test('QA #1006: unresolved numerical identifiers never produce guessed duplicate IDs', () => {
  const duplicates = duplicateStaticIds([
    { filename: 'reference.tsx', source: '<div id="sku-3"/>' },
    {
      filename: 'dynamic.tsx',
      source: [
        'const a = <input id={"sku-" + runtimeCount} />',
        'const b = <input id={`sku-${runtimeCount}`} />',
        'const c = <input {...{ id: "sku-" + getCount() }} />',
        'const d = <CustomInput id={"sku-" + 3} />',
        'const e = <CustomInput {...{ id: "sku-" + 3 }} />',
        'const f = <input {...getProps()} />',
      ].join('\n'),
    },
  ])
  assert.deepEqual(duplicates, [])
})

test('QA #1006: long additive literal chains are parsed without evaluating an identifier', () => {
  const chunks = Array.from({ length: 10 }, (_, i) => String(i))
  const expression = ['"s"'].concat(chunks.map(chunk => JSON.stringify(chunk))).join(' + ')
  const duplicate = duplicateStaticIds([
    { filename: 'known.tsx', source: '<div id="s0123456789" />' },
    { filename: 'derived.tsx', source: `<input id={${expression}} />` },
  ])
  assert.deepEqual(duplicate.map(hit => hit.id), ['s0123456789'])
})

test('QA #1006: static intrinsic occurrence preserves exact cross-file source location', () => {
  const locations = collectStaticIntrinsicIds([
    'const page = (',
    '  <form>',
    '    <label htmlFor="cost">Bedrag</label>',
    '    <input id={"price-" + 4} />',
    '    <CustomControl id={"price-" + 4} />',
    '  </form>',
    ')',
  ].join('\n'), 'synthetic.tsx')
  assert.equal(locations.length, 1)
  assert.deepEqual(locations[0], { id: 'price-4', line: 4, column: 12 })
})
