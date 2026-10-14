import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('M3 observed pack amount accepts Dutch comma decimals without rounding or guessing', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { ObservationPackAmountInput, observationFinalPackAmount, observationEditablePackAmount } =
      await vite.ssrLoadModule('/src/features/observation/ObservationPackAmountInput.tsx')

    for (const [typed, expected] of [
      ['0,75', 0.75], ['0.75', 0.75], ['1', 1], ['1,5', 1.5],
      ['.125', 0.125], [',125', 0.125], ['0,00007', 0.00007],
      ['1,2345678901', 1.2345678901], ['0', null], ['-1', null],
      ['1e3', null], ['2,', null], ['2.', null], ['1,', null],
      ['1.000,00', null], ['3,1,4', null], ['', null],
      ['Infinity', null], ['NaN', null], [null, null], [7, null],
    ]) {
      assert.equal(observationFinalPackAmount(typed), expected)
    }

    for (const [amount, expectedText] of [
      [null, ''], [0, ''], [-1, ''], [1, '1'], [0.75, '0,75'],
      [0.00007, '0,00007'], [1e-7, '0,0000001'],
      [1.234e-9, '0,000000001234'],
      [Number.NaN, ''], [Number.POSITIVE_INFINITY, ''],
    ]) {
      assert.equal(observationEditablePackAmount(amount), expectedText)
      if (expectedText) {
        assert.equal(observationFinalPackAmount(expectedText), amount,
          'focusing and blurring may not silently replace a previously saved quantity')
      }
    }

    const rendered = renderToStaticMarkup(createElement(ObservationPackAmountInput, {
      amount: 0.75,
      label: 'PLUS · rijst · verpakkingshoeveelheid',
      onAmountChange: () => assert.fail('SSR must never write observed pack quantities'),
    }))
    assert.match(rendered, /type="text"/)
    assert.match(rendered, /inputMode="decimal"/)
    assert.match(rendered, /value="0,75"/)
    assert.match(rendered, /aria-invalid="false"/)
    assert.match(rendered, /aria-label="PLUS · rijst · verpakkingshoeveelheid"/)
    assert.doesNotMatch(rendered, /type="number"|besparing bewezen|navigator\.clipboard/)

    const blank = renderToStaticMarkup(createElement(ObservationPackAmountInput, {
      amount: null,
      label: 'DekaMarkt · rijst · verpakkingshoeveelheid',
      onAmountChange: () => assert.fail('blank SSR must not invent a quantity'),
    }))
    assert.match(blank, /value=""/)
  } finally {
    await vite.close()
  }
})
