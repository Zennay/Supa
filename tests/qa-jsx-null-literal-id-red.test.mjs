import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// QA #2018 — new synthetic expected-RED on frozen #2011 AST guard.
// Load the original evaluator rather than simulating its behavior.
const source = readFileSync(
  new URL('./production-static-jsx-id-boundary.test.mjs', import.meta.url),
  'utf8',
)
const start = source.indexOf('function unwrapStaticExpression(')
const end = source.indexOf("\ntest('production TSX contains", start)
assert.ok(start >= 0 && end > start)
const { duplicateStaticIds } = new Function(
  'ts', source.slice(start, end) + '\nreturn { duplicateStaticIds }',
)(ts)
const duplicates = (...sources) => duplicateStaticIds(
  sources.map((code, index) => ({ filename: `test-${index}.tsx`, source: code })),
).map(({ id }) => id)

test('QA #2018 expected RED: string concatenation with literal null is a known intrinsic id', () => {
  assert.deepEqual(duplicates(
    '<label id="field-null" />',
    'const a = <input id={"field-" + null} />',
  ), ['field-null'])
})

test('QA #2018 expected RED: literal null template expression has deterministic string value', () => {
  assert.deepEqual(duplicates(
    '<label id="field-null" />',
    'const a = <input id={`field-${null}`} />',
  ), ['field-null'])
})

test('QA #2018 expected RED: numeric plus null is numeric zero before id interpolation', () => {
  assert.deepEqual(duplicates(
    '<label id="number-1" />',
    'const a = <input id={"number-" + (1 + null)} />',
  ), ['number-1'])
})

test('QA #2018 positive: direct React null ids and null spreads are omitted', () => {
  assert.deepEqual(duplicates(
    '<label id="null" /><label id="field-null" />',
    '<input id={null} />',
    '<section {...{ id: null }} />',
  ), [])
})

test('QA #2018 positive: runtime-dependent expressions remain unknown', () => {
  assert.deepEqual(duplicates(
    '<label id="field-null" />',
    'const a = <input id={"field-" + variable} />',
    'const b = <input id={`field-${getId()}`} />',
    'const c = <Field id={"field-" + null} />',
  ), [])
})
