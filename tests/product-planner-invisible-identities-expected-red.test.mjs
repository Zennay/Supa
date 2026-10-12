import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// Product #1925 expected RED. Invisible-only persisted day and recipe IDs
// must not authorize replacing original saved records on App mount.
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
const fn = ast.statements.find(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'canReplacePlannerRecord')
assert.ok(fn)
const js = ts.transpileModule('exports.guard = ' + fn.getText(ast), {
  fileName: 'planner-visibility-guard.ts',
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
})
assert.deepEqual(js.diagnostics, [])
const module = { exports: {} }
new Function('exports', js.outputText)(module.exports)
const guard = module.exports.guard
const raw = (days, recipes) => JSON.stringify({
  budget: 35, activeDays: days, recipeByDay: Object.fromEntries(recipes),
})
const invisible = ['\u200B', '\u200C', '\u200D', '\u2060', '\u200E', '\u200F', '\u034F']

test('product #1925 RED: invisible-only saved days must protect original bytes', () => {
  for (const id of invisible) {
    assert.equal(guard(raw(['Di', id], [['Di', 'teriyaki']])), false,
      'unexpected rewrite approval for day ' + JSON.stringify(id))
  }
})

test('product #1925 RED: invisible-only saved recipe keys and values must be protected', () => {
  for (const id of invisible) {
    assert.equal(guard(raw(['Di'], [['Di', id]])), false,
      'unexpected rewrite approval for recipe ' + JSON.stringify(id))
    assert.equal(guard(raw(['Di'], [['Di', 'teriyaki'], [id, 'tikka']])), false,
      'unexpected rewrite approval for mapping key ' + JSON.stringify(id))
  }
})

test('product #1925 GREEN: normal saved IDs and empty week remain writable', () => {
  assert.equal(guard(raw(['Ma', 'Di'], [['Ma', 'tikka'], ['Di', 'teriyaki']])), true)
  assert.equal(guard(raw([], [])), true)
  assert.equal(guard(null), true)
  assert.equal(guard(raw(['__proto__'], [])), false, 'earlier reserved-key fix remains')
})
