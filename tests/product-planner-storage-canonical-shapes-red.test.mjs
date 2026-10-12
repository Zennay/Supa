import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// Product #1925: deliberately RED on the staged planner persistence guard.
// A record containing noncanonical/duplicate identifiers is not an envelope
// that App may silently normalize and replace. Controlled JSON only; no users.
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
const fn = ast.statements.find(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'canReplacePlannerRecord')
assert.ok(fn, 'execute the actual App.tsx persistence decision')
const js = ts.transpileModule('exports.guard = ' + fn.getText(ast), {
  fileName: 'planner-guard.ts',
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
})
assert.deepEqual(js.diagnostics, [])
const mod = { exports: {} }
new Function('exports', js.outputText)(mod.exports)
const guard = mod.exports.guard
const record = (activeDays = ['Di'], recipeByDay = { Di: 'recipe-a' }) =>
  JSON.stringify({ budget: 35, activeDays, recipeByDay })

test('product #1925 RED: duplicate, blank and padded saved days cannot authorize overwriting user bytes', () => {
  for (const days of [['Di', 'Di'], [''], ['  '], ['Di '], [' Di'], ['Di', ''], ['Di', 'Di', 'Wo']]) {
    assert.equal(guard(record(days)), false, 'protect original days: ' + JSON.stringify(days))
  }
})

test('product #1925 RED: blank or noncanonical saved recipe identity cannot be silently discarded', () => {
  for (const recipes of [
    { Di: '' }, { Di: ' ' }, { Di: 'recipe-a ' }, { Di: ' recipe-a' },
    { ' Di': 'recipe-a' }, { ' ': 'recipe-a' },
  ]) {
    assert.equal(guard(record(['Di'], recipes)), false,
      'protect original recipe mapping: ' + JSON.stringify(recipes))
  }
})

test('product #1925 GREEN controls: valid shapes and future/corrupt envelopes preserve prior boundaries', () => {
  assert.equal(guard(null), true)
  assert.equal(guard(record()), true)
  assert.equal(guard(record([], {})), true, 'deliberately empty week is valid')
  assert.equal(guard(record(['Di', 'Wo'], { Di: 'recipe-a', Wo: 'recipe-b' })), true)
  assert.equal(guard(JSON.stringify({ budget: 0.01, activeDays: ['Di'], recipeByDay: { Di: 'recipe-a' } })), true)
  assert.equal(guard(JSON.stringify({ budget: 27.501, activeDays: ['Di'], recipeByDay: { Di: 'recipe-a' } })), false)
  assert.equal(guard('{broken'), false)
  assert.equal(guard(JSON.stringify({ budget: 35, activeDays: ['Di'], recipeByDay: { Di: 'recipe-a' }, version: 3 })), false)
})
