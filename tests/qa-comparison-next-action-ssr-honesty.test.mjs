import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { comparisonNextStep } from '../src/features/basket/comparisonNextStep.ts'
import {
  m2DefaultActiveDays,
  m2InitialPlan,
  m2Products,
  m2Recipes,
} from '../src/data/m2Fixture.ts'

// Compile the actual production TSX card rather than copying its markup into a
// synthetic test component. The stylesheet has no runtime effect in Node SSR.
const cardUrl = new URL('../src/features/basket/ComparisonNextActionCard.tsx', import.meta.url)
const source = readFileSync(cardUrl, 'utf8')
assert.match(source, /^import '\.\/ComparisonNextActionCard\.css'$/m)
const withoutCss = source.replace(/^import '\.\/ComparisonNextActionCard\.css'$/m, '')
const compiled = ts.transpileModule(withoutCss, {
  fileName: 'ComparisonNextActionCard.tsx',
  reportDiagnostics: true,
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
})
assert.deepEqual(compiled.diagnostics, [], 'production card must compile for SSR')
const cardModule = { exports: {} }
const requireFromCard = createRequire(cardUrl)
// The transpiled code comes only from this checked-in source file, not users.
new Function('require', 'module', 'exports', compiled.outputText)(
  requireFromCard, cardModule, cardModule.exports,
)
const { ComparisonNextActionCard } = cardModule.exports
assert.equal(typeof ComparisonNextActionCard, 'function')

const guidance = (code, canShowDifference = false, overrides = {}) => ({
  code,
  canShowDifference,
  title: 'Testmanden controleren',
  explanation: 'Geen werkelijke winkelprijzen of bewezen besparingen.',
  action: 'Controleer eerst de boodschappen.',
  ...overrides,
})
const render = (value) =>
  renderToStaticMarkup(createElement(ComparisonNextActionCard, { guidance: value }))

test('independent QA: all six comparison states render a real accessible passive status', () => {
  for (const code of [
    'choose-meals',
    'complete-products',
    'align-plans',
    'choose-different-stores',
    'review-data',
    'comparison-ready',
  ]) {
    const ready = code === 'comparison-ready'
    const html = render(guidance(code, ready))
    assert.match(html, /<section\b/)
    assert.match(html, /role="status"/)
    assert.match(html, /aria-live="polite"/)
    assert.ok(html.includes(`data-comparison-next-step="${code}"`))
    assert.ok(html.includes(`data-can-show-difference="${ready}"`))
    assert.match(html, /Testmanden controleren/)
    assert.match(html, /Geen werkelijke winkelprijzen/)
    assert.match(html, /Volgende stap:/)
    assert.match(html, /Controleer eerst de boodschappen/)
    assert.doesNotMatch(html, /<(?:button|input|select|a)\b/i, 'no dead controls')
    assert.doesNotMatch(html, /€\s*\d|EUR\s*\d/, 'card never invents money')
  }
})

test('independent QA: untrusted copy is HTML-escaped in title, explanation and next action', () => {
  const marker = '<img src=x onerror="alert(1)">'
  const html = render(guidance('review-data', false, {
    title: `Fictief ${marker}`,
    explanation: `Onveilig <script>test</script> ${marker}`,
    action: `Controleer ${marker}`,
  }))
  assert.doesNotMatch(html, /<(?:script|img)\b/i)
  assert.doesNotMatch(html, /onerror="/)
  assert.match(html, /&lt;img/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /onerror=&quot;alert\(1\)&quot;/)
  assert.equal((html.match(/&lt;img/g) || []).length, 3)
  assert.match(html, /role="status"/)
})

test('independent QA: unknown money flag stays false and long multilingual content survives SSR', () => {
  const long = '规划boodschappen🌱'.repeat(160)
  const html = render(guidance('review-data', false, {
    title: long,
    explanation: 'Vergelijking onbekend — geen besparing bewezen.',
    action: 'Controleer gegevens vóór een nieuwe vergelijking.',
  }))
  assert.ok(html.includes(long))
  assert.match(html, /data-can-show-difference="false"/)
  assert.match(html, /Vergelijking onbekend/)
  assert.match(html, /Controleer gegevens/)
  assert.doesNotMatch(html, /<button|<a\b/i)
})

test('independent QA: canonical two-store basket result renders honest ready vs empty-week advice', () => {
  const baseStore = { id: 'fictional-base', name: 'Fictieve winkel A' }
  const candidateStore = { id: 'fictional-other', name: 'Fictieve winkel B' }
  const build = (store, activeDays) => {
    const products = [
      ...m2Products.map((product) => ({
        ...product, id: `${store.id}-${product.id}`, storeId: store.id,
      })),
      {
        id: `${store.id}-garam`, storeId: store.id, name: 'Garam masala 50 g',
        packAmount: 50, packUnit: 'g', priceCents: 139, available: true,
      },
    ]
    return buildOneStoreBasket({
      store, plan: m2InitialPlan, recipes: m2Recipes, activeDays, products,
    })
  }
  for (const [days, expectedCode, eligible] of [
    [m2DefaultActiveDays, 'comparison-ready', true],
    [[], 'choose-meals', false],
  ]) {
    const baseline = build(baseStore, days)
    const candidate = build(candidateStore, days)
    const comparison = compareFullBaskets({ baseline, candidate })
    const nextStep = comparisonNextStep({ comparison, baseline, candidate })
    assert.equal(nextStep.code, expectedCode)
    assert.equal(nextStep.canShowDifference, eligible)
    const html = render(nextStep)
    assert.ok(html.includes(`data-comparison-next-step="${expectedCode}"`))
    assert.ok(html.includes(`data-can-show-difference="${eligible}"`))
    assert.match(html, /Volgende stap:/)
    if (eligible) {
      assert.match(html, /geen actuele winkelprijzen/i)
      assert.match(html, /geen.*bewezen besparingen/i)
    } else {
      assert.doesNotMatch(html, /data-can-show-difference="true"/)
      assert.match(html, /Plan eerst een maaltijd/)
    }
  }
})
