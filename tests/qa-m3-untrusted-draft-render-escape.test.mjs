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

// Independent QA of the REAL ObservationView SSR, not a hand-written mock
// renderer. Entirely synthetic strings, no actual store/participant/price data.
// Imported drafts may contain user-provided markup, but may never become DOM.
test('M3 restored collection strings remain escaped text, not executable markup or savings proof', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ObservationView } = await vite.ssrLoadModule(
      '/src/features/observation/ObservationView.tsx',
    )
    const draft = buildObservationSheet()
    draft.study.studyId = 'qa-" ><img src=x onerror=alert(1)>'
    draft.study.population = 'Student & <svg onload=alert(2)>'
    draft.study.region = 'Leiden </textarea><script>qaInjected()</script>'
    draft.baseline.store.name = 'PLUS <iframe src=javascript:alert(3)>'
    draft.candidate.store.name = 'DekaMarkt <img src=x onerror=alert(4)>'
    draft.baseline.provenanceNote = 'source <script>qaSource()</script>'
    draft.candidate.provenanceNote = 'no claim & no observed prices'
    const raw = JSON.stringify(draft)
    assert.deepEqual(restoreObservationSheetDraft(raw), draft,
      'test really exercises a restored user-controlled draft')

    let writes = 0
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: {
        getItem(key) {
          assert.equal(key, OBSERVATION_DRAFT_STORAGE_KEY)
          return raw
        },
        setItem() { writes++ },
      } },
    })
    const html = renderToStaticMarkup(createElement(ObservationView))
    assert.equal((html.match(/data-observation-line="/g) ?? []).length, 22)
    assert.match(html, /PLUS &lt;iframe/)
    assert.match(html, /DekaMarkt &lt;img/)
    assert.match(html, /&lt;script&gt;qaInjected\(\)&lt;\/script&gt;/)
    assert.match(html, /&lt;svg onload/)
    assert.doesNotMatch(html, /<(?:script|iframe|img|svg)\b/i,
      'untrusted draft text must not become a DOM element')
    assert.doesNotMatch(html, /besparing bewezen|klaar voor publicatie/i)
    assert.match(html, /Een aparte controle/)
    assert.equal(writes, 0, 'render must not write or submit any observations')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
    await vite.close()
  }
})

test('M3 future-schema storage hides original bytes and keeps manual recovery visible', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ObservationView } = await vite.ssrLoadModule(
      '/src/features/observation/ObservationView.tsx',
    )
    const privateToken = 'synthetic-private-unreadable-marker'
    const raw = JSON.stringify({
      ...buildObservationSheet(),
      schemaVersion: 10_000,
      study: { ...buildObservationSheet().study, participantKey: privateToken },
    })
    assert.equal(restoreObservationSheetDraft(raw), null)
    let writes = 0
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: {
        getItem() { return raw },
        setItem() { writes++ },
      } },
    })
    const html = renderToStaticMarkup(createElement(ObservationView))
    assert.match(html, /data-observation-recovery-warning/)
    assert.match(html, /Bewaar oorspronkelijk lokaal bestand/)
    assert.match(html, /role="alert"/)
    assert.doesNotMatch(html, new RegExp(privateToken))
    assert.equal((html.match(/data-observation-line="/g) ?? []).length, 22)
    assert.equal(writes, 0)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
    await vite.close()
  }
})
