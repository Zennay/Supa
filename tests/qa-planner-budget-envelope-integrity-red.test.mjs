import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// QA #1925: isolate and EXECUTE the actual App.tsx overwrite decision,
// without mounting the UI, evaluating arbitrary saved code, touching storage,
// or changing the original production/owner files. All records are synthetic.
const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const sourceFile = ts.createSourceFile(
  'App.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX,
)
const guard = sourceFile.statements.find(
  node => ts.isFunctionDeclaration(node) && node.name?.text === 'canReplacePlannerRecord',
)
assert.ok(guard, 'real App must expose the storage pre-write guard')
const compiled = ts.transpileModule(`exports.canReplacePlannerRecord = ${guard.getText(sourceFile)};`, {
  fileName: 'guard.ts',
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])
const module = { exports: {} }
new Function('module', 'exports', compiled.outputText)(module, module.exports)
const canReplace = module.exports.canReplacePlannerRecord
assert.equal(typeof canReplace, 'function')
function stored(budget, extra = {}) {
  return JSON.stringify({ budget, activeDays: ['Di'], recipeByDay: { Di: 'synthetic-recipe' }, ...extra })
}

test('QA #1925 expected RED: corrupt non-cent budget values are not safe-to-overwrite v2', () => {
  for (const budget of [27.501, 0.001, 42.755, 3.14159, 35.0001]) {
    assert.equal(canReplace(stored(budget)), false, `fractional-cent budget ${budget} must be protected`)
  }
})

test('QA #1925 expected RED: invalid monetary bounds must never authorize overwrite', () => {
  for (const budget of [0, -0.01, -35, 1000.01, 1001, 1e100]) {
    assert.equal(canReplace(stored(budget)), false, `unsupported budget ${budget} must be protected`)
  }
})

test('QA #1925 control: exact valid v2 money, empty storage and unknown schemas remain distinct', () => {
  assert.equal(canReplace(null), true, 'absent key is safely writable')
  for (const cents of [1, 2, 30, 99, 100, 2750, 3500, 4275, 99999, 100000]) {
    assert.equal(canReplace(stored(cents / 100)), true, `valid ${cents} cents`)
  }
  const actual = stored(27.5)
  assert.equal(canReplace(actual), true, 'ordinary v2 stays writable')
  for (const raw of [
    '', '{broken', 'null', '[]',
    '{"schemaVersion":3,"budget":27.5,"activeDays":[],"recipeByDay":{}}',
    stored(27.5, { unknownFutureField: true }),
    '{"budget":"27,50","activeDays":[],"recipeByDay":{}}',
    '{"budget":35,"activeDays":{},"recipeByDay":{}}',
    '{"budget":35,"activeDays":[],"recipeByDay":[]}',
  ]) {
    assert.equal(canReplace(raw), false, `unknown/corrupt record ${raw}`)
  }
})
