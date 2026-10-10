import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { previewPlanRecipeSwap } from '../src/domain/planRecipeSwapPreview.ts'
import { euro } from '../src/lib/money.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'

const require = createRequire(import.meta.url)
const reactServer = require('react-dom/server')
const componentSource = readFileSync(
  new URL('../src/features/planner/RecipeSwapImpactCard.tsx', import.meta.url),
  'utf8',
)
const cssSource = readFileSync(
  new URL('../src/features/planner/recipeSwapImpactCard.css', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(componentSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  },
  fileName: 'RecipeSwapImpactCard.tsx',
})
assert.deepEqual(compiled.diagnostics ?? [], [])
const componentModule = { exports: {} }
const trustedRequire = (name) => {
  if (name === 'react/jsx-runtime') return require(name)
  if (name === '../../lib/money') return { euro }
  if (name === './recipeSwapImpactCard.css') return {}
  throw new Error(`Unexpected runtime import from UI component: ${name}`)
}
new Function('require', 'module', 'exports', compiled.outputText)(
  trustedRequire, componentModule, componentModule.exports,
)
const { RecipeSwapImpactCard } = componentModule.exports
const React = require('react')
const render = (preview) =>
  reactServer.renderToStaticMarkup(React.createElement(RecipeSwapImpactCard, { preview }))
const scenario = {
  store: m2Store,
  plan: m2InitialPlan,
  recipes: m2Recipes,
  products: m2Products,
  activeDays: ['Di'],
  day: 'Di',
  replacementRecipeId: 'pasta',
}

test('rendered complete change explains direction, affected items and input-only caveat', () => {
  const html = render(previewPlanRecipeSwap(scenario))
  assert.match(html, /aria-label="Voorvertoning receptwijziging"/)
  assert.match(html, /aria-live="polite"/)
  assert.equal((html.match(/aria-live=/g) ?? []).length, 1)
  assert.match(html, /data-price-state="known"/)
  assert.match(html, /5,59/)
  assert.match(html, /lager/)
  assert.match(html, /Tomatenblokjes/)
  assert.match(html, /geen actuele winkelprijs of bewezen besparing/i)
  assert.doesNotMatch(html, /<button|<form|<input/i)
})

test('rendered unknown price suppresses a guessed euro difference', () => {
  const html = render(previewPlanRecipeSwap({
    ...scenario, products: m2Products.filter((p) => p.id !== 'spaghetti-500'),
  }))
  assert.match(html, /data-price-state="unknown"/)
  assert.match(html, /nog niet betrouwbaar te berekenen/i)
  assert.match(html, /Productkeuze nog niet bekend/)
  assert.doesNotMatch(html, /hoger\.|lager\./)
})

test('invalid preview is informational, not a hidden planner mutation', () => {
  const html = render(previewPlanRecipeSwap({ ...scenario, day: 'nonexistent' }))
  assert.match(html, /Voorvertoning niet beschikbaar/)
  assert.doesNotMatch(html, /<button|<form|<input/i)
  assert.doesNotMatch(html, /geen actuele winkelprijs/i)
})

test('React escaping keeps untrusted catalog labels inert in HTML', () => {
  const preview = previewPlanRecipeSwap(scenario)
  assert.equal(preview.status, 'ready')
  const line = preview.changes.find((entry) => entry.after?.status === 'matched')
  assert.ok(line)
  line.after.productName = '<script>alert(1)</script>'
  const html = render(preview)
  assert.doesNotMatch(html, /<script>/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
})

test('preview layout is responsive and has no fake hidden selection controls', () => {
  assert.match(cssSource, /max-width:\s*100%/)
  assert.match(cssSource, /@media\s*\(max-width:\s*480px\)/)
  assert.doesNotMatch(componentSource, /localStorage|sessionStorage|\.push\(|\.splice\(/)
})

// A cent-native display must never round a safe integer-cent value via /100.
test('very large yet safe cent deltas render their exact fractional cents', () => {
  const preview = previewPlanRecipeSwap(scenario)
  assert.equal(preview.status, 'ready')
  const extreme = 9007199254740991
  const html = render({ ...preview, deltaCents: extreme })
  assert.ok(html.includes(euro.formatCents(extreme)))
  assert.match(html, /data-price-state="known"/)
  assert.doesNotMatch(html, /—/)
  const negative = render({ ...preview, deltaCents: -extreme })
  assert.match(negative, /lager/)
  assert.ok(negative.includes(euro.formatCents(extreme)))
})

test('rendered shared-ingredient reuse shows changed demand even when pack count stays one', () => {
  const preview = previewPlanRecipeSwap({
    ...scenario,
    plan: [{ day: 'Ma', recipeId: 'teriyaki' }, { day: 'Di', recipeId: 'teriyaki' }],
    activeDays: ['Ma', 'Di'],
  })
  assert.equal(preview.status, 'ready')
  const rice = preview.changes.find((line) => line.ingredientId === 'basmati-rice')
  assert.equal(rice.before.packs, 1)
  assert.equal(rice.after.packs, 1)
  const html = render(preview)
  assert.match(html, /300 g[^<]*·[^<]*1 × Basmati rijst/)
  assert.match(html, /150 g[^<]*·[^<]*1 × Basmati rijst/)
  assert.equal((html.match(/aria-live=/g) ?? []).length, 1)
})
