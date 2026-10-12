import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as ts from 'typescript'

// QA #2004: synthetic expected-RED on frozen #1899, without altering its
// production TSX scan or original guard file. JavaScript Boolean primitive
// concatenation is static and must not escape duplicate-ID detection.
const source = readFileSync(
  new URL('./production-static-jsx-id-boundary.test.mjs', import.meta.url),
  'utf8',
)
const start = source.indexOf('function unwrapStaticExpression(')
const end = source.indexOf("\ntest('production TSX contains", start)
assert.ok(start >= 0 && end > start)
const { duplicateStaticIds } = new Function(
  'ts',
  source.slice(start, end) + '\nreturn { duplicateStaticIds }',
)(ts)

test('QA #2004 expected RED: Boolean true concatenation collides with a literal intrinsic id', () => {
  const duplicates = duplicateStaticIds([
    { filename: 'static.tsx', source: '<label id="state-true" />' },
    { filename: 'boolean.tsx', source: [
      'const a = <input id={"state-" + true} />',
      'const b = <span id={`state-${true}`} />',
    ].join('\n') },
  ])
  assert.deepEqual(
    duplicates.map(({ id }) => id),
    ['state-true', 'state-true'],
  )
})

test('QA #2004 expected RED: Boolean false template/spread string ids must be compared', () => {
  const duplicates = duplicateStaticIds([
    { filename: 'reference.tsx', source: '<output id="status-false" />' },
    { filename: 'compiled.tsx', source: [
      'const a = <input id={`status-${false}`} />',
      'const b = <div {...{ id: "status-" + false }} />',
    ].join('\n') },
  ])
  assert.deepEqual(
    duplicates.map(({ id }) => id),
    ['status-false', 'status-false'],
  )
})

test('QA #2004: dynamic variables and nonintrinsic component props remain unknown', () => {
  const duplicates = duplicateStaticIds([
    { filename: 'reference.tsx', source: '<output id="status-true" />' },
    { filename: 'dynamic.tsx', source: [
      'const a = <input id={"status-" + runtimeFlag} />',
      'const b = <div id={`status-${runtimeFlag}`} />',
      'const c = <Widget id={"status-" + true} />',
      'const d = <Widget {...{ id: "status-" + true }} />',
      'const e = <div id={"status-" + getFlag()} />',
    ].join('\n') },
  ])
  assert.deepEqual(duplicates, [])
})
