import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { comparisonNextStep } from '../src/features/basket/comparisonNextStep.ts'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2InitialPlan, m2DefaultActiveDays, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// Compiles the actual read-only UI component. CSS is intentionally a no-op in
// server-rendered tests; no browser, retailer network or real evidence involved.
const nodeRequire = createRequire(import.meta.url)
const file = readFileSync(new URL('../src/features/basket/ComparisonNextActionCard.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(file, {
  fileName: 'ComparisonNextActionCard.tsx',
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])
const ui = { exports: {} }
new Function('module', 'exports', 'require', compiled.outputText)(
  ui, ui.exports,
  (id) => id.endsWith('.css') ? {} : nodeRequire(id),
)
const { ComparisonNextActionCard } = ui.exports

function assertGeneric(input) {
  const outcome = comparisonNextStep(input)
  assert.equal(outcome.code, 'review-data')
  assert.equal(outcome.canShowDifference, false)
  assert.doesNotMatch(JSON.stringify(outcome), /private-test-sentinel/)
  const rendered = renderToStaticMarkup(createElement(ComparisonNextActionCard, { guidance: outcome }))
  assert.match(rendered, /role="status"/)
  assert.match(rendered, /data-can-show-difference="false"/)
  assert.match(rendered, /data-comparison-next-step="review-data"/)
  assert.doesNotMatch(rendered, /private-test-sentinel|<button/i)
}

test('root and financial nested accessors never execute and never leak exception text', () => {
  for (const bad of [
    Object.defineProperty({ candidate: {}, comparison: {} }, 'baseline', {
      get() { throw Error('private-test-sentinel') },
      enumerable: true,
    }),
    {
      baseline: Object.defineProperty({}, 'selectedMealCount', {
        get() { throw Error('private-test-sentinel') }, enumerable: true,
      }),
      candidate: {}, comparison: {},
    },
    Object.defineProperty({}, 'comparison', {
      get() { throw Error('private-test-sentinel') }, enumerable: true,
    }),
  ]) {
    assert.doesNotThrow(() => assertGeneric(bad))
  }
})

test('revoked root and nested proxy records refuse comparison without rendering crashes', () => {
  const root = Proxy.revocable({}, {})
  root.revoke()
  assert.doesNotThrow(() => assertGeneric(root.proxy))
  for (const field of ['baseline', 'candidate', 'comparison']) {
    const nested = Proxy.revocable({}, {})
    nested.revoke()
    assert.doesNotThrow(() => assertGeneric({
      baseline: {}, candidate: {}, comparison: {}, [field]: nested.proxy,
    }))
  }
})

test('throwing Proxy metadata traps remain private behind presentation fallback', () => {
  let triggered = 0
  const proxy = new Proxy({}, {
    ownKeys() { triggered++; throw Error('private-test-sentinel') },
  })
  assert.doesNotThrow(() => assertGeneric(proxy))
  assert.equal(triggered, 1, 'ownKeys trap is not avoidable for all Proxy records')
})

test('inherited monetary facts, cyclic graphs and accessor arrays abstain', () => {
  const inherited = Object.create({ baseline: { selectedMealCount: 2 } })
  inherited.candidate = {}
  inherited.comparison = {}
  assertGeneric(inherited)
  const cyclic = { baseline: {}, candidate: {}, comparison: {} }
  cyclic.baseline.reuse = cyclic
  assertGeneric(cyclic)
  const deltas = [1]
  Object.defineProperty(deltas, '0', { enumerable: true, get() { throw Error('private-test-sentinel') } })
  assertGeneric({ baseline: {}, candidate: {}, comparison: { lineDeltas: deltas } })
})

function basket(id, delta) {
  const store = { id, name: 'Fictional example' }
  return buildOneStoreBasket({
    store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    products: [
      ...m2Products.map((p) => ({
        ...p, id: `${id}-${p.id}`, storeId: id, priceCents: p.priceCents + delta,
      })),
      {
        id: `${id}-garam`, storeId: id, name: 'Garam masala 50 g',
        packAmount: 50, packUnit: 'g', priceCents: 139 + delta, available: true,
      },
    ],
  })
}

test('real canonical matched basket math preserves all three consumer guidance outcomes', () => {
  for (const cents of [-10, 0, 10]) {
    const baseline = basket('a-fake-baseline', 0)
    const candidate = basket('b-fake-candidate', cents)
    const comparison = compareFullBaskets({ baseline, candidate })
    assert.equal(comparison.claimable, true)
    const before = JSON.stringify({ baseline, candidate, comparison })
    const advice = comparisonNextStep({ baseline, candidate, comparison })
    assert.equal(advice.code, 'comparison-ready')
    assert.equal(advice.canShowDifference, true)
    assert.match(advice.explanation, /geen actuele winkelprijzen/)
    assert.equal(JSON.stringify({ baseline, candidate, comparison }), before)
    const html = renderToStaticMarkup(createElement(ComparisonNextActionCard, { guidance: advice }))
    assert.match(html, /data-can-show-difference="true"/)
    assert.match(html, /vergelijkbaar/i)
  }
})

test('real unmatched basket still requests human product choices without any savings claim', () => {
  const baseline = basket('a-fake-baseline', 0)
  const candidate = {
    ...basket('b-fake-candidate', 0),
    lines: baseline.lines.slice(0, 1).map(line => ({
      ...line, status: 'unresolved', requirement: { amount: null, unit: 'unknown' },
    })),
    matchedLineCount: 0, unresolvedLineCount: 1, totalCents: 0,
  }
  const guidance = comparisonNextStep({
    baseline, candidate, comparison: { claimable: false, outcome: 'unknown', reasons: [] },
  })
  assert.equal(guidance.code, 'complete-products')
  assert.equal(guidance.canShowDifference, false)
})
