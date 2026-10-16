import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { selectWeekMenuText, weekMenuSelectionFeedback } from '../src/features/planner/selectWeekMenuText.ts'

test('mobile selection result is honest about needing user action to copy', () => {
  const value = 'SUPA · Weekmenu\nMa: Pasta'
  const calls = []
  const field = {
    readOnly: true,
    value,
    focus() { calls.push('focus') },
    select() { calls.push('select') },
    setSelectionRange(start, end) { calls.push(['range', start, end]) },
  }
  assert.equal(selectWeekMenuText(field, value), true)
  assert.deepEqual(calls, ['focus', 'select', ['range', 0, value.length]])
  assert.match(weekMenuSelectionFeedback(true), /Tekst geselecteerd/)
  assert.match(weekMenuSelectionFeedback(true), /Kopieer op je apparaat/)
  assert.doesNotMatch(weekMenuSelectionFeedback(true), /gekopieerd|klembord/i)
})

test('mobile browser refuses select: readable long-press fallback, no dishonest copy claim', () => {
  const value = 'SUPA · Weekmenu'
  const field = {
    value,
    readOnly: true,
    focus() {},
    select() { throw new Error('Browser denied') },
    setSelectionRange() { throw new Error('should never be invoked') },
  }
  assert.equal(selectWeekMenuText(field, value), false)
  const feedback = weekMenuSelectionFeedback(false)
  assert.match(feedback, /Automatisch selecteren lukt niet/)
  assert.match(feedback, /Houd de tekst ingedrukt/)
  assert.doesNotMatch(feedback, /opgeslagen|gekopieerd|gestart/i)
})

test('routed real React share component never announces selection or download before a user click', async () => {
  const vite = await createServer({
    configFile: new URL('../vite.config.ts', import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  })
  try {
    const { WeekShareManualCopy } = await vite.ssrLoadModule('/src/features/planner/WeekShareManualCopy.tsx')
    const html = renderToStaticMarkup(createElement(WeekShareManualCopy, {
      text: 'SUPA · Weekmenu\nMa: Pasta\n\nDit is een planning, geen prijsopgave.\nReceptschattingen en echte winkelprijzen zijn niet inbegrepen.',
      rows: 8,
    }))
    assert.match(html, /Selecteer alle tekst/)
    assert.match(html, /Bewaar als tekstbestand/)
    assert.match(html, /readOnly/)
    assert.doesNotMatch(html, /Tekst geselecteerd|Automatisch selecteren lukt niet|Download gestart/)
  } finally {
    await vite.close()
  }
})
