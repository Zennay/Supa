import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import {
  buildObservationSheet,
  OBSERVATION_DRAFT_STORAGE_KEY,
  restoreObservationSheetDraft,
} from '../src/domain/m3ObservationSheet.ts'

// Do not use a synthetic React copy: these cases exercise the actual live
// M3 product-detail editor after canonical local-draft restoration.
async function renderStoredDraft(draft, assertRendered) {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const raw = JSON.stringify(draft)
    const restored = restoreObservationSheetDraft(raw)
    assert.ok(restored, 'test input is a structurally supported draft')
    let writes = 0
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: {
        getItem(key) { assert.equal(key, OBSERVATION_DRAFT_STORAGE_KEY); return raw },
        setItem() { writes++ },
      } },
    })
    const { ObservationView } = await vite.ssrLoadModule(
      '/src/features/observation/ObservationView.tsx',
    )
    const html = renderToStaticMarkup(createElement(ObservationView))
    assert.equal((html.match(/data-observation-line="/g) ?? []).length, 22)
    assert.equal(writes, 0, 'rendering must never write back source notes')
    assertRendered(html, restored)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
    await vite.close()
  }
}

test('QA M3 real available product fields keep hostile product labels and source URLs inert', async () => {
  const draft = buildObservationSheet()
  const product = draft.baseline.lines[0].observedProduct
  Object.assign(product, {
    available: true,
    productId: 'qa-"><script>productId()</script>',
    productName: 'QA <img src=x onerror=alert(1)> & beschuit',
    packAmount: 1,
    packUnit: 'piece',
    packCount: 1,
    priceCents: 249,
    sourceUrl: 'javascript:alert(2)',
    note: 'QA </textarea><iframe src=javascript:alert(3)>',
  })
  await renderStoredDraft(draft, (html, restored) => {
    assert.equal(restored.baseline.lines[0].observedProduct.sourceUrl,
      'javascript:alert(2)', 'tests genuine restored untrusted value')
    assert.match(html, /QA &lt;img src=x onerror=alert\(1\)&gt; &amp; beschuit/)
    assert.match(html, /&lt;script&gt;productId\(\)&lt;\/script&gt;/)
    assert.match(html, /&lt;iframe src=javascript:alert\(3\)&gt;/)
    assert.match(html, /type="url"[^>]*value="javascript:alert\(2\)"/)
    assert.doesNotMatch(html, /<(?:img|script|iframe)\b/i,
      'product strings cannot create executable elements')
    assert.doesNotMatch(html, /(?:href|src)="javascript:/i,
      'an optional source URL remains an editable value, never a clickable unsafe link')
    assert.doesNotMatch(html, /besparing bewezen|klaar voor publicatie/i)
  })
})

test('QA M3 unavailable product discards stale notes and URLs before rendering', async () => {
  const draft = buildObservationSheet()
  const oldPrivateMarker = 'qa-private-stale-note-not-for-the-screen'
  const product = draft.candidate.lines[0].observedProduct
  Object.assign(product, {
    available: false,
    productId: oldPrivateMarker,
    productName: oldPrivateMarker,
    sourceUrl: 'https://example.invalid/' + oldPrivateMarker,
    note: oldPrivateMarker,
  })
  await renderStoredDraft(draft, (html, restored) => {
    assert.equal(restored.candidate.lines[0].observedProduct.available, false)
    assert.equal(restored.candidate.lines[0].observedProduct.note, '')
    assert.equal(restored.candidate.lines[0].observedProduct.sourceUrl, '')
    assert.doesNotMatch(html, new RegExp(oldPrivateMarker))
    assert.match(html, /Meten zonder gokken/)
    assert.doesNotMatch(html, /besparing bewezen|klaar voor publicatie/i)
  })
})
