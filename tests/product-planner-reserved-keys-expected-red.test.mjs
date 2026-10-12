import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// #1925 deliberately RED: the staged App write guard must not erase
// unsupported prototype-reserved planner identities from durable storage.
// All records are synthetic, and production main remains untouched.
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
const declaration = ast.statements.find(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'canReplacePlannerRecord')
assert.ok(declaration, 'execute the actual App storage decision')
const built = ts.transpileModule('exports.guard = ' + declaration.getText(ast), {
  fileName: 'planner-reserved-keys.ts',
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
})
assert.deepEqual(built.diagnostics, [])
const module = { exports: {} }
new Function('exports', built.outputText)(module.exports)
const guard = module.exports.guard
const record = (days, entries) => JSON.stringify({
  budget: 35, activeDays: days, recipeByDay: Object.fromEntries(entries),
})

test('product #1925 RED: reserved own recipe keys must not authorize rewriting saved bytes', () => {
  for (const reserved of ['__proto__', 'prototype', 'constructor']) {
    const raw = record(['Di'], [['Di', 'recipe-a'], [reserved, 'recipe-b']])
    assert.ok(JSON.parse(raw).recipeByDay[reserved])
    assert.equal(guard(raw), false, 'protect reserved recipe key ' + reserved)
  }
})

test('product #1925 RED: reserved saved active-day names must not authorize normalization', () => {
  for (const reserved of ['__proto__', 'prototype', 'constructor']) {
    assert.equal(guard(record(['Di', reserved], [['Di', 'recipe-a']])), false,
      'protect reserved active day ' + reserved)
  }
})

test('product #1925 GREEN: ordinary synthetic envelopes remain accepted; malformed futures protected', () => {
  assert.equal(guard(null), true)
  assert.equal(guard(record(['Di', 'Wo'], [['Di', 'recipe-a'], ['Wo', 'recipe-b']])), true)
  assert.equal(guard(record([], [])), true)
  assert.equal(guard('{"budget":35,"activeDays":[],"recipeByDay":{},"version":3}'), false)
})
