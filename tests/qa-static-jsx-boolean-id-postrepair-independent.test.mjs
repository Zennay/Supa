import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// QA #2004: independent source-executed acceptance on frozen guard proposal.
// Synthetic TSX only; no DOM claim or changes to production UI.
const source = readFileSync(
  new URL('./production-static-jsx-id-boundary.test.mjs', import.meta.url),
  'utf8',
)
const start = source.indexOf('function unwrapStaticExpression(')
const end = source.indexOf("\ntest('production TSX contains", start)
assert.ok(start >= 0 && end > start, 'read real guard definitions, not a mock')
const { duplicateStaticIds } = new Function(
  'ts',
  source.slice(start, end) + '\nreturn { duplicateStaticIds }',
)(ts)

const scan = (...sources) => duplicateStaticIds(
  sources.map((source, n) => ({ filename: `synthetic-${n}.tsx`, source })),
).map(({ id }) => id)

test('QA #2004: literal Boolean true in addition and a template collides with intrinsic ID', () => {
  const duplicates = scan(
    '<label id="state-true" />',
    'const a = <input id={"state-" + true} />',
    'const b = <output id={`state-${true}`} />',
  )
  assert.deepEqual(duplicates, ['state-true', 'state-true'])
})

test('QA #2004: literal false in template and static JSX spread collides', () => {
  const duplicates = scan(
    '<label id="status-false" />',
    'const a = <div id={`status-${false}`} />',
    'const b = <section {...{ id: "status-" + false }} />',
  )
  assert.deepEqual(duplicates, ['status-false', 'status-false'])
})

test('QA #2004: parenthesized and typed Boolean constants keep their static identity', () => {
  const duplicates = scan(
    '<label id="typed-true" />',
    '<label id="typed-false" />',
    'const a = <div id={"typed-" + (true satisfies boolean)} />',
    'const b = <div id={`typed-${(false as boolean)}`} />',
  )
  assert.deepEqual(duplicates, ['typed-true', 'typed-false'])
})

test('QA #2004: direct Boolean id props are not real HTML ID strings', () => {
  // React DOM omits id={true} / id={false}; must not raise false positives.
  assert.deepEqual(scan(
    '<label id="true" /><label id="false" />',
    '<div id={true} />',
    '<div id={false} />',
    '<section {...{ id: true }} />',
    '<section {...{ id: false }} />',
  ), [])
})

test('QA #2004: dynamic Boolean variables/calls and custom component props stay unknown', () => {
  assert.deepEqual(scan(
    '<label id="state-true" />',
    '<label id="status-false" />',
    'const a = <input id={"state-" + runtimeFlag} />',
    'const b = <div id={`status-${getFlag()}`} />',
    'const c = <Field id={"state-" + true} />',
    'const d = <Field {...{ id: "status-" + false }} />',
    'const e = <span {...dynamicProps} />',
  ), [])
})

test('QA #2004: static Boolean IDs do not collapse distinct true and false values', () => {
  assert.deepEqual(scan(
    '<label id="answer-true" />',
    'const a = <input id={"answer-" + false} />',
    'const b = <input id={`answer-${false}`} />',
    'const c = <input id={"answer-" + true} />',
  ), ['answer-false', 'answer-true'])
})
