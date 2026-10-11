import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import {
  buildObservationSheet,
  OBSERVATION_DRAFT_STORAGE_KEY,
} from '../src/domain/m3ObservationSheet.ts'

const cssUrl = new URL('../src/features/observation/ObservationView.css', import.meta.url)
const matches = (html, expression) => [...html.matchAll(expression)].length

test('real M3 observation TSX structure exposes the selectors used by narrow-card copy containment', async () => {
  // Independent structural SSR assurance of issue #789's CSS candidate.
  // It is NOT a measured-width/mobile screenshot or visual overflow proof.
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const reads = []
  const writes = []

  try {
    const { ObservationView } = await vite.ssrLoadModule(
      '/src/features/observation/ObservationView.tsx',
    )
    const sheet = buildObservationSheet()
    const longStoreName = 'Synthetische-Supermarkt-Met-Een-Buitengewoon-Lange-Winkelnaam-'.repeat(5)
    const otherStoreName = 'Synthetische-Tweede-Winkel-Met-Lange-Winkelnaam-'.repeat(5)
    sheet.baseline.store.name = longStoreName
    sheet.candidate.store.name = otherStoreName

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem(key) {
            reads.push(key)
            return key === OBSERVATION_DRAFT_STORAGE_KEY ? JSON.stringify(sheet) : null
          },
          setItem(key, value) { writes.push([key, value]) },
        },
      },
    })

    const html = renderToStaticMarkup(createElement(ObservationView))
    const css = await readFile(cssUrl, 'utf8')

    // Both baseline and candidate must use the actual nested heading DOM
    // structure targeted by .observation-card-heading > div / h3 rules.
    assert.equal(matches(html, /class="observation-card-heading"/g), 2)
    assert.equal(matches(html, /<div class="observation-card-heading"><div>/g), 2)
    assert.equal(matches(html, /<span class="observation-count">/g), 2)
    assert.ok(html.includes(longStoreName))
    assert.ok(html.includes(otherStoreName))
    assert.match(css, /\.observation-card-heading > div\s*\{[^}]*min-width:\s*0/s)
    assert.match(css, /\.observation-card-heading h3\s*\{[^}]*overflow-wrap:\s*anywhere/s)
    assert.match(css, /\.observation-count\s*\{[^}]*flex:\s*0\s+0\s+auto/s)

    // Every rendered ingredient summary needs exactly one shrinkable text
    // wrapper and nonshrinking status; CSS must target that true hierarchy.
    const lineTotal = sheet.baseline.lines.length + sheet.candidate.lines.length
    assert.ok(lineTotal >= 20, 'canonical M3 full-demand fixture is required')
    assert.equal(matches(html, /class="observation-line"/g), lineTotal)
    assert.equal(matches(html, /<summary><div><strong>/g), lineTotal)
    assert.equal(matches(html, /class="line-state"/g), lineTotal)
    assert.match(css, /\.observation-line summary > div\s*\{[^}]*min-width:\s*0;[^}]*overflow-wrap:\s*anywhere/s)

    // Rendering must never write synthetic draft data or create field proof.
    assert.deepEqual(reads, [OBSERVATION_DRAFT_STORAGE_KEY])
    assert.deepEqual(writes, [])
    assert.doesNotMatch(html, /publicSavingsClaimEligible|evidenceStatus="observed"/)

    // A restored draft with drifted canonical demand MUST NOT inject a
    // fabricated ingredient label into the UI or appear field-ready.
    // This is a render-level check; the canonical restoration boundary owns
    // the underlying validation.
    const forged = structuredClone(sheet)
    forged.baseline.lines[0].ingredientLabel = 'SYNTHETIC-UNTRUSTED-INGREDIENT'
    forged.study.studyId = 'synthetic-altered-observation'
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: {
        getItem(key) {
          reads.push(key)
          return key === OBSERVATION_DRAFT_STORAGE_KEY ? JSON.stringify(forged) : null
        },
        setItem(key, value) { writes.push([key, value]) },
      } },
    })
    const rejected = renderToStaticMarkup(createElement(ObservationView))
    assert.doesNotMatch(rejected, /SYNTHETIC-UNTRUSTED-INGREDIENT|synthetic-altered-observation/)
    assert.match(rejected, /Nog [0-9]+ controles? open/)
    assert.equal(matches(rejected, /class="observation-line"/g), lineTotal)

    // Conversely, an otherwise canonical *synthetic* draft with HTML-like
    // display text should remain usable but may only render escaped TEXT.
    const withMarkup = structuredClone(sheet)
    withMarkup.baseline.store.name = '<img src=x onerror=alert(1)>'
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: {
        getItem(key) {
          reads.push(key)
          return key === OBSERVATION_DRAFT_STORAGE_KEY ? JSON.stringify(withMarkup) : null
        },
        setItem(key, value) { writes.push([key, value]) },
      } },
    })
    const safe = renderToStaticMarkup(createElement(ObservationView))
    assert.match(safe, /&lt;img/)
    assert.doesNotMatch(safe, /<img\\s/i)
    assert.equal(matches(safe, /class="observation-card-heading"/g), 2)
    assert.deepEqual(writes, [], 'none of the render variants may persist data')
    assert.ok(reads.every((key) => key === OBSERVATION_DRAFT_STORAGE_KEY))
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow)
    else delete globalThis.window
    await vite.close()
  }
})
