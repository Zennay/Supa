import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

import { comparisonNextStep } from '../src/features/basket/comparisonNextStep.ts'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes,
} from '../src/data/m2Fixture.ts'

// Render the real, checked-in TSX component. No browser I/O, marketplace data,
// participant records, source grants or network calls enter this test.
const cardUrl = new URL('../src/features/basket/ComparisonNextActionCard.tsx', import.meta.url)
const source = readFileSync(cardUrl, 'utf8')
assert.match(source, /^import '\.\/ComparisonNextActionCard\.css'$/m)
const js = ts.transpileModule(source.replace(/^import '\.\/ComparisonNextActionCard\.css'$/m, ''), {
  fileName: 'ComparisonNextActionCard.tsx',
  reportDiagnostics: true,
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
})
assert.deepEqual(js.diagnostics, [])
const cardModule = { exports: {} }
new Function('require', 'module', 'exports', js.outputText)(
  createRequire(cardUrl), cardModule, cardModule.exports,
)
const { ComparisonNextActionCard } = cardModule.exports
assert.equal(typeof ComparisonNextActionCard, 'function')

function renderedAdvisory(raw) {
  let guidance
  assert.doesNotThrow(() => { guidance = comparisonNextStep(raw) })
  let html
  assert.doesNotThrow(() => {
    html = renderToStaticMarkup(createElement(ComparisonNextActionCard, { guidance }))
  })
  return { guidance, html }
}
function expectSafeAbstention(raw) {
  const { guidance, html } = renderedAdvisory(raw)
  assert.equal(guidance.code, 'review-data')
  assert.equal(guidance.canShowDifference, false)
  assert.match(html, /data-comparison-next-step="review-data"/)
  assert.match(html, /data-can-show-difference="false"/)
  assert.match(html, /role="status"/)
  assert.match(html, /aria-live="polite"/)
  assert.match(html, /De vergelijking is nog niet betrouwbaar/)
  assert.match(html, /Een prijsverschil zou misleidend zijn/)
  assert.match(html, /Volgende stap:/)
  assert.doesNotMatch(html, /€\s*\d|\bEUR\s*\d|<script|<img\b|onerror=/i)
  assert.doesNotMatch(html, /synthetic-internal-secret-marker/)
}

function tooManyKeys() {
  const keys = Array.from({ length: 8193 }, (_, index) => `fictional-key-${index}`)
  let descriptorCalls = 0
  const record = new Proxy({}, {
    ownKeys() { return keys },
    getOwnPropertyDescriptor() {
      descriptorCalls++
      throw Error('synthetic-internal-secret-marker')
    },
  })
  return { record, descriptorCalls: () => descriptorCalls }
}

test('QA SSR: oversized top-level and nested retailer snapshots abstain before descriptor traps or private text', () => {
  for (const side of ['root', 'baseline', 'candidate', 'comparison']) {
    const { record, descriptorCalls } = tooManyKeys()
    const input = side === 'root' ? record : {
      baseline: {}, candidate: {}, comparison: {}, [side]: record,
    }
    expectSafeAbstention(input)
    assert.equal(descriptorCalls(), 0, `${side}: large record must fail before descriptor reads`)
  }
})

test('QA SSR: throwing key enumeration and revoked Proxy produce the same safe consumer guidance', () => {
  const trapped = new Proxy({}, {
    ownKeys() { throw Error('synthetic-internal-secret-marker') },
  })
  expectSafeAbstention(trapped)
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  expectSafeAbstention({ baseline: {}, candidate: revoked.proxy, comparison: {} })
})

test('QA SSR: an accessor cannot execute or escape as HTML during safe fallback', () => {
  let called = 0
  const hostile = Object.defineProperty({ baseline: {}, candidate: {} }, 'comparison', {
    enumerable: true,
    get() {
      called++
      throw Error('synthetic-internal-secret-marker')
    },
  })
  expectSafeAbstention(hostile)
  assert.equal(called, 0, 'own-data descriptor snapshot must never execute a getter')
})

test('QA SSR: budget protection preserves normal, complete synthetic two-store comparison', () => {
  const basket = (id) => {
    const store = { id, name: `Fictional shop ${id}` }
    const products = [
      ...m2Products.map(product => ({
        ...product, id: `${id}-${product.id}`, storeId: id,
      })),
      {
        id: `${id}-garam`, storeId: id, name: 'Garam masala 50 g',
        packAmount: 50, packUnit: 'g', priceCents: 139, available: true,
      },
    ]
    return buildOneStoreBasket({
      store, plan: m2InitialPlan, recipes: m2Recipes,
      activeDays: m2DefaultActiveDays, products,
    })
  }
  const baseline = basket('fictional-a')
  const candidate = basket('fictional-b')
  const comparison = compareFullBaskets({ baseline, candidate })
  assert.equal(comparison.claimable, true)
  const snapshot = JSON.stringify({ baseline, candidate, comparison })
  const { guidance, html } = renderedAdvisory({ baseline, candidate, comparison })
  assert.equal(guidance.code, 'comparison-ready')
  assert.equal(guidance.canShowDifference, true)
  assert.match(html, /data-comparison-next-step="comparison-ready"/)
  assert.match(html, /data-can-show-difference="true"/)
  assert.match(html, /geen actuele winkelprijzen of bewezen besparingen/)
  assert.doesNotMatch(html, /€\s*\d|\bEUR\s*\d/)
  assert.equal(JSON.stringify({ baseline, candidate, comparison }), snapshot)
})
