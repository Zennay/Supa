import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { comparisonNextStep } from '../src/features/basket/comparisonNextStep.ts'
import { m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

// Server-render actual standalone card, not a claim about live BasketView.
const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/features/basket/ComparisonNextActionCard.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(
  source.replace(/^import\s+['"]\.\/ComparisonNextActionCard\.css['"]\s*;?\s*$/m, ''),
  { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 },
    fileName: 'ComparisonNextActionCard.tsx', reportDiagnostics: true },
)
assert.deepEqual(compiled.diagnostics, [])
const output = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(output, output.exports, require)
const { ComparisonNextActionCard } = output.exports

function basket(store) {
  return buildOneStoreBasket({
    store, plan: m2InitialPlan, recipes: m2Recipes, activeDays: ['Di'],
    products: m2Products.map((p) => ({ ...p, id: `${store.id}:${p.id}`, storeId: store.id })),
  })
}

test('SSR: the previous claimable result must not render a ready card for changed planner demand', () => {
  const baseline = basket({ id: 'qa-ssr-a', name: 'Synthetic A' })
  const original = basket({ id: 'qa-ssr-b', name: 'Synthetic B' })
  const comparison = compareFullBaskets({ baseline, candidate: original })
  assert.equal(comparison.claimable, true)
  const normal = renderToStaticMarkup(React.createElement(
    ComparisonNextActionCard,
    { guidance: comparisonNextStep({ baseline, candidate: original, comparison }) },
  ))
  assert.match(normal, /data-comparison-next-step="comparison-ready"/)
  assert.match(normal, /data-can-show-difference="true"/)

  const changed = structuredClone(original)
  const matched = changed.lines.find((line) => line.status === 'matched')
  assert.ok(matched)
  matched.requirement.amount += 1
  assert.equal(compareFullBaskets({ baseline, candidate: changed }).claimable, false)
  const snapshot = structuredClone(changed)
  const html = renderToStaticMarkup(React.createElement(
    ComparisonNextActionCard,
    { guidance: comparisonNextStep({ baseline, candidate: changed, comparison }) },
  ))
  assert.match(html, /role="status"/)
  assert.match(html, /data-can-show-difference="false"/)
  assert.doesNotMatch(html, /data-comparison-next-step="comparison-ready"/)
  assert.deepEqual(changed, snapshot)
})
