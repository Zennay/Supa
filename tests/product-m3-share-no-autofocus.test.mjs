import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('M3 manual week copy never steals keyboard focus when preview opens', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { WeekShareManualCopy } = await vite.ssrLoadModule(
      '/src/features/planner/WeekShareManualCopy.tsx',
    )
    const html = renderToStaticMarkup(createElement(WeekShareManualCopy, {
      text: 'SUPA · Weekmenu\nMa: Fictieve maaltijd',
      rows: 8,
    }))
    assert.match(html, /Weekmenu om handmatig te kopiëren/)
    assert.match(html, /Selecteer alle tekst/)
    assert.match(html, /readOnly|readonly/)
    assert.doesNotMatch(html, /autofocus|autoFocus/i,
      'a read-only preview must not steal mobile keyboard or screen-reader focus')
    assert.doesNotMatch(html, /Weekbudget|besparing|navigator\.clipboard/i)
  } finally {
    await vite.close()
  }
})
