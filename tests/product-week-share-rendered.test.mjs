import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

// Uses the actual TSX App via the project's Vite + React compilation, not a
// text-only JSX assertion or a mock of its product presentation functions.
test('actual routed Planner renders the private M3 sharing controls and no prepared draft', async () => {
  const vite = await createServer({
    configFile: new URL('../vite.config.ts', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  })

  try {
    const { App } = await vite.ssrLoadModule('/src/App.tsx')
    const html = renderToStaticMarkup(createElement(App))

    assert.match(html, /aria-label="Weekmenu delen"/)
    assert.match(html, /Toon kopieertekst/)
    assert.match(html, /Mijn weekbudget ook opnemen \(optioneel\)/)
    assert.match(html, /Bereidingstijd en porties opnemen/)
    assert.match(html, /Deel je geplande maaltijden, zonder winkelprijzen\./)

    const shareBlock = html.match(/<section class="week-share-panel"[\s\S]*?<\/section>/)?.[0]
    assert.ok(shareBlock, 'expected actual rendered share section')
    assert.equal((shareBlock.match(/type="checkbox"/g) ?? []).length, 2)
    assert.doesNotMatch(shareBlock, /\bchecked(?:=|\s|>)/, 'both personal choices must default off')
    assert.doesNotMatch(shareBlock, /<textarea|Weekmenu om handmatig te kopiëren/)
    assert.match(shareBlock, /role="status"/)
    assert.match(shareBlock, /aria-live="polite"/)
    assert.match(html, /Geplande maaltijden/)
  } finally {
    await vite.close()
  }
})
