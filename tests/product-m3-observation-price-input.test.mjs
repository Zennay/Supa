import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { observationPriceCents } from '../src/features/observation/observationCollectionUi.ts'

test('M3 Dutch price editor keeps integer cents and renders comma input without inventing prices', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { ObservationPriceInput, observationEditablePriceText } =
      await vite.ssrLoadModule('/src/features/observation/ObservationPriceInput.tsx')

    for (const [cents, expected] of [
      [null, ''],
      [0, '0,00'],
      [1, '0,01'],
      [249, '2,49'],
      [1050, '10,50'],
      [9007199254740991, '90071992547409,91'],
      [-1, ''],
      [Number.NaN, ''],
    ]) {
      assert.equal(observationEditablePriceText(cents), expected)
    }

    const html = renderToStaticMarkup(createElement(ObservationPriceInput, {
      priceCents: 249,
      onPriceChange: () => assert.fail('SSR may not modify observed prices'),
    }))
    assert.match(html, /type="text"/)
    assert.match(html, /inputMode="decimal"/)
    assert.match(html, /value="2,49"/)
    assert.match(html, /aria-invalid="false"/)
    assert.doesNotMatch(html, /type="number"|onChange|navigator\.clipboard|besparing bewezen/)

    const emptyHtml = renderToStaticMarkup(createElement(ObservationPriceInput, {
      priceCents: null,
      onPriceChange: () => assert.fail('empty SSR may not create a price'),
    }))
    assert.match(emptyHtml, /value=""/)
    assert.doesNotMatch(emptyHtml, /prijs van \d|€\d/)

    for (const [entered, expectedCents] of [
      ['2,49', 249], ['2.49', 249], ['0,01', 1], ['2,', 200],
      ['', null], ['2,499', null], ['1e3', null], ['-1', null],
      ['NaN', null], ['1.000,00', null],
    ]) {
      assert.equal(observationPriceCents(entered), expectedCents)
    }
  } finally {
    await vite.close()
  }
})
