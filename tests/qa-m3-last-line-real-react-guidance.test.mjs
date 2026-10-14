import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import {
  OBSERVATION_DRAFT_STORAGE_KEY,
  buildObservationSheet,
  observationSheetReadiness,
} from '../src/domain/m3ObservationSheet.ts'

// QA of the actual React collection page from product #2437, not an
// independently reimplemented instruction function. Entirely simulated data.
function sheetWithLastMissing(side, missingField) {
  const sheet = buildObservationSheet()
  Object.assign(sheet.study, {
    studyId: 'synthetic-task-step',
    participantKey: 'anon-test',
    population: 'fictieve studenten',
    region: 'testgebied',
    weekStart: '2026-10-12',
    priceContext: 'in-store',
  })
  for (const [storeSide, storeName, time] of [
    ['baseline', 'PLUS QA vestiging', '2026-10-13T09:00:00Z'],
    ['candidate', 'DekaMarkt QA vestiging', '2026-10-13T10:00:00Z'],
  ]) {
    Object.assign(sheet[storeSide], {
      store: { id: 'fictional-' + storeSide, name: storeName },
      evidenceId: storeSide + '-qa',
      provenanceNote: 'Uitsluitend synthetische QA',
      source: 'manual-cart',
      observedAt: time,
    })
  }
  for (const row of sheet.baseline.lines) row.observedProduct.available = false
  for (const row of sheet.candidate.lines) row.observedProduct.available = false
  const product = sheet[side].lines[10].observedProduct
  if (missingField === 'productName') {
    product.available = true
  } else {
    Object.assign(product, {
      available: true, productName: 'Testartikel alleen',
      packAmount: 1, packUnit: 'piece', packCount: 2, priceCents: null,
    })
  }
  return sheet
}

test('rendered 22-line M3 page names the last missing product field without private evidence claims', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const { ObservationView } = await vite.ssrLoadModule(
      '/src/features/observation/ObservationView.tsx',
    )
    for (const [side, missingField, detail] of [
      ['baseline', 'productName', 'Noteer de werkelijke productnaam'],
      ['candidate', 'priceCents', 'Noteer de werkelijk geobserveerde prijs'],
    ]) {
      const sheet = sheetWithLastMissing(side, missingField)
      assert.equal(observationSheetReadiness(sheet).ready, false)
      const original = JSON.stringify(sheet)
      let writes = 0
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { localStorage: {
          getItem(key) {
            assert.equal(key, OBSERVATION_DRAFT_STORAGE_KEY)
            return original
          },
          setItem() { writes++ },
        } },
      })
      const html = renderToStaticMarkup(createElement(ObservationView))
      const card = html.match(/class="observation-next-action"[\s\S]*?<\/section>/)?.[0] ?? ''
      // The live page must expose the specific task to a human and keep
      // its canonical field rows unchanged; a generic card alone is not enough.
      assert.match(html, new RegExp(detail), side + ':' + missingField)
      assert.match(card || html, side === 'baseline' ? /PLUS/ : /DekaMarkt/)
      assert.equal((html.match(/data-observation-line="/g) ?? []).length, 22)
      assert.doesNotMatch(html, /besparing bewezen|klaar voor publicatie/i)
      assert.equal(writes, 0)
      assert.equal(JSON.stringify(sheet), original)
    }
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow)
    else delete globalThis.window
    await vite.close()
  }
})
