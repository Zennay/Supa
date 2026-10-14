import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import react from '@vitejs/plugin-react'
import { createServer } from 'vite'

// Render the *real App.tsx React tree* with Vite's TSX transform, without
// opening a network port or creating a fake customer/retailer session.
test('independent: actual M3 planner share UI defaults to private, accessible manual copy', async () => {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../', import.meta.url)),
    plugins: [react()],
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
  })

  try {
    const { App } = await server.ssrLoadModule('/src/App.tsx')
    const html = renderToStaticMarkup(createElement(App))
    const sharePanel = html.match(/<section\b[^>]*class="week-share-panel"[^>]*>[\s\S]*?<\/section>/)?.[0]
    assert.ok(sharePanel, 'share must be inside a discoverable planner panel')

    assert.match(sharePanel, /aria-label="Weekmenu delen"/)
    assert.match(sharePanel, /Deel je geplande maaltijden, zonder winkelprijzen\./)
    assert.match(sharePanel, /<button\b[^>]*type="button"[^>]*>Toon kopieertekst<\/button>/)
    assert.match(sharePanel, /Mijn weekbudget ook opnemen \(optioneel\)/)
    assert.match(sharePanel, /role="status"[^>]*aria-live="polite"/)

    const checkbox = sharePanel.match(/<input\b[^>]*type="checkbox"[^>]*>/)?.[0]
    assert.ok(checkbox, 'budget option must be a real keyboard-operable checkbox')
    assert.doesNotMatch(checkbox, /(?:^|\s)checked(?:=|\s|>)/, 'private budget must start unchecked')
    assert.doesNotMatch(sharePanel, /<textarea\b/, 'share text must not exist before explicit user action')
    assert.doesNotMatch(html, /€\s*\d+[,.]\d{2}.*weekmenu/i, 'initial UI must not disclose a user budget')
  } finally {
    await server.close()
  }
})
