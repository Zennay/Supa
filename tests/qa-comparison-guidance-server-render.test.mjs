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
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes } from '../src/data/m2Fixture.ts'

const require = createRequire(import.meta.url)
const tsx = readFileSync(
  new URL('../src/features/basket/ComparisonNextActionCard.tsx', import.meta.url),
  'utf8',
)

// Node's strip-types runner does not execute TSX or CSS directly. Transpile the
// real checked-in component for server rendering without editing its source.
// CSS is intentionally inspected separately in the source contract.
const compiled = ts.transpileModule(
  tsx.replace(/^import\s+['"]\.\/ComparisonNextActionCard\.css['"]\s*;?\s*$/m, ''),
  {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'ComparisonNextActionCard.tsx',
    reportDiagnostics: true,
  },
)
assert.deepEqual(compiled.diagnostics, [], 'component must transpile for real SSR')

const compiledModule = { exports: {} }
const execute = new Function('module', 'exports', 'require', compiled.outputText)
execute(compiledModule, compiledModule.exports, require)
const { ComparisonNextActionCard } = compiledModule.exports
assert.equal(typeof ComparisonNextActionCard, 'function')

const baselineStore = { id: 'qa-render-store-a', name: 'Controlled example A' }
const candidateStore = { id: 'qa-render-store-b', name: 'Controlled example B' }

function basket(store, { priceDelta = 0, days = m2DefaultActiveDays, incomplete = false } = {}) {
  const products = [
    ...m2Products.map((p) => ({
      ...p,
      id: `${store.id}:${p.id}`,
      storeId: store.id,
      priceCents: p.priceCents + priceDelta,
    })),
    {
      id: `${store.id}:garam`,
      storeId: store.id,
      name: 'Garam masala 50 g',
      packAmount: 50,
      packUnit: 'g',
      priceCents: 139 + priceDelta,
      available: true,
    },
  ]
  return buildOneStoreBasket({
    store,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: days,
    products: incomplete
      ? products.filter((p) => !p.id.endsWith(':garam'))
      : products,
  })
}

function actualGuidance(baseline, candidate) {
  return comparisonNextStep({
    baseline,
    candidate,
    comparison: compareFullBaskets({ baseline, candidate }),
  })
}

function render(guidance) {
  return renderToStaticMarkup(
    React.createElement(ComparisonNextActionCard, { guidance }),
  )
}

test('actual rendered React HTML preserves accessible status and all three guidance texts', () => {
  const guidance = actualGuidance(basket(baselineStore), basket(candidateStore))
  const html = render(guidance)
  assert.equal(guidance.code, 'comparison-ready')
  assert.match(html, /<section\b[^>]*role="status"[^>]*aria-live="polite"/)
  assert.match(html, /data-comparison-next-step="comparison-ready"/)
  assert.match(html, /data-can-show-difference="true"/)
  assert.ok(html.includes(guidance.title))
  assert.ok(html.includes(guidance.explanation))
  assert.ok(html.includes(guidance.action))
  assert.match(html, /Volgende stap: /)
  assert.doesNotMatch(html, /<button\b|<a\b|<input\b/i)
})

test('SSR renders the correct passive state for real missing, empty and different-store inputs', () => {
  const scenarios = [
    ['choose-meals', basket(baselineStore, { days: [] }), basket(candidateStore, { days: [] })],
    ['complete-products', basket(baselineStore), basket(candidateStore, { incomplete: true })],
    ['align-plans', basket(baselineStore), basket(candidateStore, { days: m2DefaultActiveDays.slice(0, 1) })],
    ['choose-different-stores', basket(baselineStore), basket(baselineStore)],
    ['comparison-ready', basket(baselineStore), basket(candidateStore)],
  ]

  for (const [expected, before, after] of scenarios) {
    const guidance = actualGuidance(before, after)
    assert.equal(guidance.code, expected)
    const html = render(guidance)
    assert.ok(html.includes(`data-comparison-next-step="${expected}"`))
    assert.ok(
      html.includes(`data-can-show-difference="${expected === 'comparison-ready'}"`),
    )
    assert.match(html, /<p\b[^>]*comparison-next-action__instruction/)
    assert.doesNotMatch(html, /M2|M3|claimable|converter|assessment/i)
  }
})

test('escaping in the rendered card treats attacker-controlled labels as plain text', () => {
  const marker = '<img src=x onerror="window.hijacked=1">'
  const guidance = {
    code: 'review-data',
    title: marker,
    explanation: `Provenance & cost: ${marker}`,
    action: `Controleer ${marker}`,
    canShowDifference: false,
  }
  const html = render(guidance)

  assert.doesNotMatch(html, /<(?:img|script)\b/i)
  assert.match(html, /&lt;img/)
  assert.match(html, /&amp; cost/)
  assert.equal((html.match(/&lt;img/g) ?? []).length, 3)
  assert.match(html, /data-can-show-difference="false"/)
})

test('SSR is deterministic and does not mutate the supplied guidance across repeated renders', () => {
  const guidance = actualGuidance(basket(baselineStore), basket(candidateStore, { priceDelta: -7 }))
  const copy = structuredClone(guidance)
  const html = render(guidance)
  for (let run = 0; run < 10; run += 1) {
    assert.equal(render(guidance), html)
    assert.deepEqual(guidance, copy)
  }
  assert.match(html, /geen actuele winkelprijzen/)
  assert.match(html, /geen[^<]*besparingen/)
})

test('CSS import remains a single scoped, relative stylesheet dependency', () => {
  const cssImports = [...tsx.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)].map((match) => match[1])
  assert.deepEqual(cssImports, ['./ComparisonNextActionCard.css'])
})
