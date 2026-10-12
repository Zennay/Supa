import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// QA #2018: independent synthetic acceptance on frozen staged null-literal repair.
// Reuse the actual AST scanner source; no production TSX or runtime browser use.
const original = readFileSync(
  new URL('./production-static-jsx-id-boundary.test.mjs', import.meta.url),
  'utf8',
)
const start = original.indexOf('function unwrapStaticExpression(')
const end = original.indexOf("\ntest('production TSX contains", start)
assert.ok(start >= 0 && end > start)
const { duplicateStaticIds } = new Function(
  'ts', original.slice(start, end) + '\nreturn { duplicateStaticIds }',
)(ts)

function duplicateIds(...inputs) {
  return duplicateStaticIds(inputs.map((source, index) => ({
    filename: `synthetic-${index}.tsx`, source,
  }))).map(({ id }) => id)
}

test('QA #2018: static null concatenates on either side and through typed parentheses', () => {
  assert.deepEqual(duplicateIds(
    '<label id="null-tail" /><label id="head-null" />',
    'const a = <input id={null + "-tail"} />',
    'const b = <div id={"head-" + (null satisfies null)} />',
  ), ['null-tail', 'head-null'])
})

test('QA #2018: multiple null operands use JS numeric zero until a string enters', () => {
  assert.deepEqual(duplicateIds(
    '<label id="sum-0" /><label id="sum-3" />',
    'const a = <div id={"sum-" + (null + null)} />',
    'const b = <div id={"sum-" + (1 + (null + 2))} />',
  ), ['sum-0', 'sum-3'])
})

test('QA #2018: null template interpolation is the literal word null', () => {
  assert.deepEqual(duplicateIds(
    '<label id="null" /><label id="pre-null-post" />',
    'const a = <input id={`${null}`} />',
    'const b = <input id={`pre-${null}-post`} />',
  ), ['null', 'pre-null-post'])
})

test('QA #2018: direct React null or Boolean ids do not produce phantom DOM ids', () => {
  assert.deepEqual(duplicateIds(
    '<label id="null" /><label id="true" /><label id="false" />',
    '<input id={null} /><input id={true} /><input id={false} />',
    '<section {...{ id: null }} /><section {...{ id: true }} />',
  ), [])
})

test('QA #2018: invalid BigInt+null and runtime-dependent expressions stay unknown', () => {
  assert.deepEqual(duplicateIds(
    '<label id="sum-1" /><label id="value-null" />',
    'const a = <div id={"sum-" + (1n + null)} />',
    'const b = <div id={"value-" + nullableVar} />',
    'const c = <div id={`value-${run()}`} />',
    'const d = <Field id={"value-" + null} />',
  ), [])
})

test('QA #2018: existing Boolean and BigInt static string coercion survives repair', () => {
  assert.deepEqual(duplicateIds(
    '<label id="state-true" /><label id="big-12" />',
    'const a = <div id={"state-" + true} />',
    'const b = <div id={"big-" + 12n} />',
  ), ['state-true', 'big-12'])
})
