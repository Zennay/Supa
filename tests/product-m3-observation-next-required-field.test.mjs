import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import {
  buildObservationSheet,
  OBSERVATION_DRAFT_STORAGE_KEY,
  restoreObservationSheetDraft,
  withObservedProductAvailability,
} from '../src/domain/m3ObservationSheet.ts'
import {
  observationNextRequiredProductField,
  observationRequiredFieldLabels,
} from '../src/features/observation/observationRequiredLineField.ts'

test('M3 next required product field guides exactly one missing human observation', () => {
  const sheet = buildObservationSheet()
  const original = structuredClone(sheet)
  const line = structuredClone(sheet.baseline.lines[0])
  assert.equal(observationNextRequiredProductField(line), 'available')
  line.observedProduct = withObservedProductAvailability(line.observedProduct, false)
  assert.equal(observationNextRequiredProductField(line), null)
  line.observedProduct = withObservedProductAvailability(line.observedProduct, true)
  assert.equal(observationNextRequiredProductField(line), 'productName')
  line.observedProduct.productName = 'Echte vermelding'
  assert.equal(observationNextRequiredProductField(line), 'packAmount')
  line.observedProduct.packAmount = 0.75
  assert.equal(observationNextRequiredProductField(line), 'packUnit')
  line.observedProduct.packUnit = 'g'
  assert.equal(observationNextRequiredProductField(line), 'priceCents')
  line.observedProduct.packCount = 0
  assert.equal(observationNextRequiredProductField(line), 'packCount')
  line.observedProduct.packCount = 2
  assert.equal(observationNextRequiredProductField(line), 'priceCents')
  line.observedProduct.priceCents = 0
  assert.equal(observationNextRequiredProductField(line), null)
  line.observedProduct.priceCents = -1
  assert.equal(observationNextRequiredProductField(line), 'priceCents')
  assert.deepEqual(sheet, original, 'UI guidance never changes an observation draft')
  assert.deepEqual(Object.keys(observationRequiredFieldLabels), [
    'available', 'productName', 'packAmount', 'packUnit', 'packCount', 'priceCents',
  ])
})

test('actual Meten product line labels have stable focus targets and correct next missing detail', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const sheet = buildObservationSheet()
    const line = sheet.baseline.lines[0]
    line.observedProduct = {
      ...withObservedProductAvailability(line.observedProduct, true),
      productName: 'Geobserveerd product',
      packAmount: 0.75,
      packUnit: 'g',
      packCount: 2,
      priceCents: null,
    }
    const json = JSON.stringify(sheet)
    assert.ok(restoreObservationSheetDraft(json))
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem(key) {
            assert.equal(key, OBSERVATION_DRAFT_STORAGE_KEY)
            return json
          },
        },
      },
    })
    const { ObservationView } = await vite.ssrLoadModule('/src/features/observation/ObservationView.tsx')
    const html = renderToStaticMarkup(createElement(ObservationView))
    assert.match(html, /Nog invullen: prijs per verpakking\./)
    for (const field of Object.keys(observationRequiredFieldLabels)) {
      assert.match(html, new RegExp('data-observation-product-field="' + field + '"'))
    }
    assert.match(html, /data-observation-line="/)
    assert.match(html, /Echte winkelprijzen verzamelen/)
    assert.doesNotMatch(html, /besparing bewezen|klaar voor publicatie/)
    const source = await readFile(
      new URL('../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8',
    )
    assert.match(source, /const missingField = currentLine/)
    assert.match(source, /observationNextRequiredProductField\(currentLine\)/)
    assert.match(source, /line\.querySelector<HTMLInputElement \| HTMLSelectElement>/)
    assert.match(source, /target \?\? line\.querySelector<HTMLSelectElement>\('select'\)/)
    assert.doesNotMatch(source, /document\.querySelector\(nextIncomplete\.ingredientId\)/)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
    await vite.close()
  }
})
