import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

// Actual product TSX via Vite SSR: a download button must never appear
// before explicit preparation of the private current plan.
test('real Planner defers private file export until user opens prepared text', async () => {
  const vite = await createServer({
    configFile: new URL('../vite.config.ts', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  })
  try {
    const { App } = await vite.ssrLoadModule('/src/App.tsx')
    const initialHtml = renderToStaticMarkup(createElement(App))
    assert.match(initialHtml, /Toon kopieertekst/)
    assert.doesNotMatch(initialHtml, /Bewaar als tekstbestand|supa-weekmenu\.txt/)
    assert.doesNotMatch(initialHtml, /<textarea[^>]*id="week-share-text"/)

    const { WeekShareManualCopy } = await vite.ssrLoadModule(
      '/src/features/planner/WeekShareManualCopy.tsx',
    )
    const preview = 'SUPA · Weekmenu\n\nMa: Crème brûlée\n\nDit is een planning, geen prijsopgave.\nReceptschattingen en echte winkelprijzen zijn niet inbegrepen.'
    const html = renderToStaticMarkup(
      createElement(WeekShareManualCopy, { text: preview, rows: 8 }),
    )
    assert.match(html, /Weekmenu om handmatig te kopiëren/)
    assert.match(html, /Selecteer alle tekst/)
    assert.match(html, /Bewaar als tekstbestand/)
    assert.match(html, /readOnly/)
    assert.match(html, /Ma: Crème brûlée/)
    assert.ok(html.indexOf('Bewaar als tekstbestand') > html.indexOf('<textarea'),
      'the explicit local download comes after inspecting the read-only prepared text')
    assert.doesNotMatch(html, /Download gestart|Download niet beschikbaar|Weekbudget/)
  } finally {
    await vite.close()
  }
})
