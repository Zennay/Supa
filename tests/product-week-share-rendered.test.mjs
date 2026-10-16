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
    const html = renderToStaticMarkup(createElement(App, { initialTab: 'planner' }))

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

    // SUPA is planner-first and budget-first on narrow screens: the actual
    // weekly plan must appear before secondary sharing tools in document flow.
    const planPosition = html.indexOf('Plan eerst. Vergelijk daarna.')
    const sharingPosition = html.indexOf('aria-label="Weekmenu delen"')
    assert.ok(planPosition >= 0 && sharingPosition > planPosition,
      'the selected meal plan is the primary screen, before optional sharing')

    // Render the actual conditional export component (not mounted until
    // consentfully requested by the user) and prove copy selection affordance.
    const { WeekShareManualCopy } = await vite.ssrLoadModule(
      '/src/features/planner/WeekShareManualCopy.tsx',
    )
    const selected = 'Ma: Tikka met kip\\nWo: Romige pasta'
    const preview = renderToStaticMarkup(
      createElement(WeekShareManualCopy, { text: selected, rows: 8 }),
    )
    assert.match(preview, /Weekmenu om handmatig te kopiëren/)
    assert.match(preview, /Selecteer alle tekst/)
    assert.match(preview, /type="button"/)
    assert.match(preview, /<textarea/)
    assert.match(preview, /readOnly(?:=""|\\s|>)/i)
    assert.match(preview, /Ma: Tikka met kip/)
    assert.match(preview, /Wo: Romige pasta/)
  } finally {
    await vite.close()
  }
})
