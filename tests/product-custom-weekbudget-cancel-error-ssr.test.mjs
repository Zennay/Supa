import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

import { euro } from '../src/lib/money.ts'
import { assessPlannerBudgetCents } from '../src/lib/plannerBudgetCents.ts'
import { RecipeEstimateDisclosure } from '../src/features/planner/RecipeEstimateDisclosure.ts'
import {
  parseCustomWeekBudgetCents,
  validCustomWeekBudgetEuros,
} from '../src/features/planner/customWeekBudget.ts'

// Render actual compiled TSX for deterministic editor states (without DOM or
// browser hydration). We override PlannerView's three useState slots *only*.
const require = createRequire(import.meta.url)
const source = readFileSync(
  new URL('../src/features/planner/PlannerView.tsx', import.meta.url), 'utf8',
).replace(/^import\s+['"]\.\/planner\.css['"]\s*;?\s*$/m, '')
const compiled = ts.transpileModule(source, {
  fileName: 'PlannerView.tsx',
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])

const props = {
  budget: 27.5,
  activeDays: [], plannedMeals: [], recipes: [],
  basketTotalCents: 1969, basketUnresolvedLineCount: 0,
  onBudgetChange() {}, onToggleDay() {}, onRecipeChange() {}, onReset() {},
}
function renderEditor([expanded, draft, error]) {
  let slot = 0
  const imported = name => {
    if (name === 'react') return {
      ...React,
      useState(initial) {
        const value = [expanded, draft, error][slot++]
        return [value === undefined ? initial : value, () => {}]
      },
    }
    if (name === 'react/jsx-runtime') return require(name)
    if (name === '../../lib/money') return { euro }
    if (name === '../../lib/plannerBudgetCents.ts') return { assessPlannerBudgetCents }
    if (name === './RecipeEstimateDisclosure.ts') return { RecipeEstimateDisclosure }
    if (name === './customWeekBudget.ts') {
      return { parseCustomWeekBudgetCents, validCustomWeekBudgetEuros }
    }
    throw Error('Unexpected import ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, imported,
  )
  return renderToStaticMarkup(React.createElement(module.exports.PlannerView, props))
}

test('product #1424: expanded budget editor exposes a labelled cancel and one submit', () => {
  const html = renderEditor([true, '27,50', ''])
  assert.match(html, /<form[^>]*id="custom-weekbudget-form"/)
  assert.match(html, /<label for="custom-weekbudget-value">Eigen weekbudget/)
  assert.match(html, /<button[^>]*type="submit"[^>]*>Budget opslaan<\/button>/)
  assert.match(html, /<button[^>]*type="button"[^>]*>Annuleren<\/button>/)
  assert.match(html, /aria-describedby="custom-weekbudget-hint"/)
  assert.doesNotMatch(html, /id="custom-weekbudget-error"/)
  assert.doesNotMatch(html, /role="alert"/)
})

test('product #1424: invalid input markup associates its error with the actual input', () => {
  const html = renderEditor([true, '27,501', 'Vul een bedrag van €0,01 t/m €1.000,00 in, met maximaal twee decimalen.'])
  assert.match(html, /id="custom-weekbudget-value"[^>]*aria-invalid="true"/)
  assert.match(html, /aria-describedby="custom-weekbudget-hint custom-weekbudget-error"/)
  assert.match(html, /<p id="custom-weekbudget-hint"/)
  assert.match(html, /<p id="custom-weekbudget-error" role="alert"/)
  assert.match(html, /maximaal twee decimalen/)
  assert.match(html, /<button[^>]*type="button"[^>]*>Annuleren<\/button>/)
})

test('product #1424: closed editor renders neither cancelled draft nor expired error', () => {
  const html = renderEditor([false, '99,99', 'Invalid example'])
  assert.match(html, /aria-expanded="false"/)
  assert.doesNotMatch(html, /id="custom-weekbudget-value"/)
  assert.doesNotMatch(html, /id="custom-weekbudget-error"/)
  assert.doesNotMatch(html, /Annuleren/)
  assert.doesNotMatch(html, /99,99/)
  assert.doesNotMatch(html, /Invalid example/)
})
