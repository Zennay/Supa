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
    const html = renderToStaticMarkup(createElement(App, { initialTab: 'planner' }))
    const sharePanel = html.match(/<section\b[^>]*class="week-share-panel"[^>]*>[\s\S]*?<\/section>/)?.[0]
    assert.ok(sharePanel, 'share must be inside a discoverable planner panel')

    assert.match(sharePanel, /aria-label="Weekmenu delen"/)
    assert.match(sharePanel, /Deel je geplande maaltijden, zonder winkelprijzen\./)
    assert.match(sharePanel, /<button\b[^>]*type="button"[^>]*>Toon kopieertekst<\/button>/)
    assert.match(sharePanel, /Mijn weekbudget ook opnemen \(optioneel\)/)
    assert.match(sharePanel, /role="status"[^>]*aria-live="polite"/)

    assert.match(sharePanel, /Bereidingstijd en porties opnemen/)
    const checkboxes = [...sharePanel.matchAll(/<input\b[^>]*type="checkbox"[^>]*>/g)]
      .map((match) => match[0])
    assert.equal(checkboxes.length, 2, 'budget and details must be two distinct opt-ins')
    for (const [index, checkbox] of checkboxes.entries()) {
      assert.doesNotMatch(checkbox, /(?:^|\s)checked(?:=|\s|>)/,
        `privacy option ${index} must start unchecked`)
    }
    assert.equal((sharePanel.match(/class="week-share-privacy"/g) ?? []).length, 2,
      'each opt-in must have a clickable accessible label')
    assert.doesNotMatch(sharePanel, /<textarea\b/, 'share text must not exist before explicit user action')
    // Planner's own weekbudget is intentionally visible in its budget card.
    // Only the *sharing panel* must withhold the private value until opt-in.
    assert.doesNotMatch(sharePanel, /€\s*\d+[,.]\d{2}/i,
      'share panel must not disclose the user budget before explicit opt-in')
  } finally {
    await server.close()
  }
})
