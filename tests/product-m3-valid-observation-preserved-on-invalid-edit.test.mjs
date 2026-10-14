import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

test('M3 bad price/amount edits preserve human evidence while deliberate blank clears it', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const price = await vite.ssrLoadModule('/src/features/observation/ObservationPriceInput.tsx')
    const pack = await vite.ssrLoadModule('/src/features/observation/ObservationPackAmountInput.tsx')

    for (const [typed, expected] of [
      ['2,49', { kind: 'accept', value: 249 }],
      ['0', { kind: 'accept', value: 0 }],
      ['  ', { kind: 'accept', value: null }],
      ['', { kind: 'accept', value: null }],
      ['2,', { kind: 'reject' }],
      ['2.999', { kind: 'reject' }],
      ['1e3', { kind: 'reject' }],
      ['-1', { kind: 'reject' }],
      [null, { kind: 'reject' }],
    ]) {
      assert.deepEqual(price.observationPriceEditDecision(typed), expected)
    }

    for (const [typed, expected] of [
      ['0,75', { kind: 'accept', value: 0.75 }],
      ['0.00007', { kind: 'accept', value: 0.00007 }],
      ['  ', { kind: 'accept', value: null }],
      ['', { kind: 'accept', value: null }],
      ['0,', { kind: 'reject' }],
      ['0', { kind: 'reject' }],
      ['1e3', { kind: 'reject' }],
      ['1,2,3', { kind: 'reject' }],
      [null, { kind: 'reject' }],
    ]) {
      assert.deepEqual(pack.observationPackAmountEditDecision(typed), expected)
    }

    let measuredPrice = 249
    for (const typed of ['2,', '1e3', '-2']) {
      const result = price.observationPriceEditDecision(typed)
      if (result.kind === 'accept') measuredPrice = result.value
      assert.equal(measuredPrice, 249, 'invalid entries never overwrite previously observed cents')
    }
    let observedAmount = 0.75
    for (const typed of ['0,', '1e2', '-1']) {
      const result = pack.observationPackAmountEditDecision(typed)
      if (result.kind === 'accept') observedAmount = result.value
      assert.equal(observedAmount, 0.75, 'invalid entries never overwrite previously observed pack size')
    }
    assert.deepEqual(price.observationPriceEditDecision(''), { kind: 'accept', value: null })
    assert.deepEqual(pack.observationPackAmountEditDecision(''), { kind: 'accept', value: null })

    const priceMarkup = renderToStaticMarkup(createElement(price.ObservationPriceInput, {
      priceCents: 249,
      label: 'PLUS · rijst · prijs per verpakking',
      onPriceChange: () => assert.fail('SSR must not mutate observed prices'),
    }))
    const amountMarkup = renderToStaticMarkup(createElement(pack.ObservationPackAmountInput, {
      amount: 0.75,
      label: 'DekaMarkt · rijst · verpakkingshoeveelheid',
      onAmountChange: () => assert.fail('SSR must not mutate observed quantities'),
    }))
    assert.match(priceMarkup, /value="2,49"/)
    assert.match(amountMarkup, /value="0,75"/)
    assert.match(priceMarkup, /aria-label="PLUS/)
    assert.match(amountMarkup, /aria-label="DekaMarkt/)
    assert.doesNotMatch(priceMarkup + amountMarkup, /besparing bewezen/i)
  } finally {
    await vite.close()
  }
})

test('live M3 price and package controls guard saved state after malformed blur', async () => {
  for (const [filename, decision, handler, prop] of [
    ['ObservationPriceInput.tsx', 'observationPriceEditDecision', 'onPriceChange', 'priceCents'],
    ['ObservationPackAmountInput.tsx', 'observationPackAmountEditDecision', 'onAmountChange', 'amount'],
  ]) {
    const source = await readFile(new URL(
      '../src/features/observation/' + filename, import.meta.url), 'utf8')
    assert.match(source, new RegExp('const decision = ' + decision + '\\(event\\.currentTarget\\.value\\)'))
    assert.match(source, /if \(decision\.kind === 'accept'\) \{/)
    assert.match(source, new RegExp('if \\(decision\\.value !== ' + prop + '\\) ' + handler + '\\(decision\\.value\\)'))
    assert.match(source, /\} else \{\s*setRejected\(true\)\s*\}/)
    assert.match(source, /setRejected\(false\)/)
    assert.match(source, /aria-invalid=\{invalid/)
    assert.match(source, /Ongeldige invoer is niet opgeslagen/)
    assert.doesNotMatch(source, new RegExp(handler + '\\((?:observationFinalPriceCents|observationFinalPackAmount)\\(event\\.currentTarget\\.value\\)\\)'))
  }
})
