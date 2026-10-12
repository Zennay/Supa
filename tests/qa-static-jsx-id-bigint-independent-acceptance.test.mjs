import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// Independent POSTREPAIR acceptance on frozen BigInt QA guard #1895.
// Only controlled synthetic TSX AST snippets; not production/browser M3 evidence.
const source = readFileSync(
  new URL('./production-static-jsx-id-boundary.test.mjs', import.meta.url), 'utf8',
)
const begin = source.indexOf('function unwrapStaticExpression(')
const end = source.indexOf("\ntest('production TSX contains", begin)
assert.ok(begin >= 0 && end > begin)
const { collectStaticIntrinsicIds, duplicateStaticIds } = new Function(
  'ts', source.slice(begin, end) +
  '\nreturn { collectStaticIntrinsicIds, duplicateStaticIds }',
)(ts)

test('QA #1006 postrepair: BigInt binary/octal/hex and separators become exact decimal DOM ids', () => {
  const duplicates = duplicateStaticIds([
    { filename: 'known.tsx', source: '<><label id="radix-5" /><label id="radix-10" /><label id="radix-255" /><label id="radix-10000" /></>' },
    {
      filename: 'computed.tsx',
      source: [
        'const a = <input id={"radix-" + 0b101n} />',
        'const b = <input id={"radix-" + 0o12n} />',
        'const c = <output {...{ id: "radix-" + 0xFFn }} />',
        'const d = <span id={"radix-" + 10_000n} />',
      ].join('\n'),
    },
  ])
  assert.deepEqual(duplicates.map(hit => hit.id),
    ['radix-5', 'radix-10', 'radix-255', 'radix-10000'])
})

test('QA #1006 postrepair: typed negative/zero BigInt and chained string additions retain JS text identity', () => {
  const tick = String.fromCharCode(96)
  const duplicates = duplicateStaticIds([
    { filename: 'known.tsx', source: '<><div id="typed--3" /><div id="typed-0" /><div id="chain-12" /></>' },
    {
      filename: 'computed.tsx',
      source: [
        'const a = <input id={' + tick + 'typed-${(-3n as bigint)}' + tick + '} />',
        'const b = <input id={"typed-" + (-0n)} />',
        'const c = <span id={"chain-" + 1n + 2n} />',
      ].join('\n'),
    },
  ])
  assert.deepEqual(duplicates.map(hit => hit.id), ['typed--3', 'typed-0', 'chain-12'])
})

test('QA #1006 postrepair: huge BigInt remains exact rather than IEEE-754 rounded', () => {
  const literal = '123456789012345678901234567890123456789n'
  const decimal = literal.slice(0, -1)
  const duplicates = duplicateStaticIds([
    { filename: 'known.tsx', source: '<div id="large-' + decimal + '" />' },
    { filename: 'computed.tsx', source: '<span id={"large-" + ' + literal + '} />' },
  ])
  assert.equal(duplicates.length, 1)
  assert.equal(duplicates[0].id, 'large-' + decimal)
  assert.notEqual(duplicates[0].id, 'large-' + String(Number(decimal)))
})

test('QA #1006 postrepair: dynamic and custom components stay unobserved', () => {
  const duplicates = duplicateStaticIds([
    { filename: 'known.tsx', source: '<div id="x-2" />' },
    { filename: 'dynamic.tsx', source: [
      'const a = <input id={"x-" + dynamicBigInt} />',
      'const b = <input id={"x-" + getBigInt()} />',
      'const c = <CustomWidget id={"x-" + 2n} />',
      'const d = <CustomWidget {...{id: "x-" + 2n}} />',
    ].join('\n') },
  ])
  assert.deepEqual(duplicates, [])
})

test('QA #1006 postrepair: BigInt duplicate location points to actual id attribute', () => {
  const occurrences = collectStaticIntrinsicIds([
    'const v = (',
    '  <section>',
    '    <label htmlFor="serial">Serienummer</label>',
    '    <input id={"serial-" + 10n} />',
    '  </section>',
    ')',
  ].join('\n'), 'bigint.tsx')
  assert.deepEqual(occurrences, [{ id: 'serial-10', line: 4, column: 12 }])
})
