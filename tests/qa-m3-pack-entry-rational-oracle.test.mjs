import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

// Independent decimal rational oracle (BigInt), not the product's string-based
// canonicalization. These are deliberately fictional physical measurements.
function exactDecimal(value) {
  const [whole = '', decimal = ''] = value.replace(',', '.').split('.')
  const digits = BigInt((whole || '0') + decimal)
  return { digits, scale: decimal.length }
}
function sameDecimal(left, right) {
  const a = exactDecimal(left)
  const b = exactDecimal(right)
  return a.digits * (10n ** BigInt(b.scale)) ===
    b.digits * (10n ** BigInt(a.scale))
}
function syntheticInputs() {
  const integerParts = ['0', '1', '2', '7', '101', '0002', '9007199254740991']
  const lengths = [1, 2, 3, 7, 11, 15, 16, 17, 19, 24, 40, 100, 300, 325]
  const unique = new Set(['0,75', '0002,5000', ',125', '.125',
    '1,0000000000000001', '2.9999999999999999', '0.000000000000000000000000123',
    '9007199254740991', '9007199254740991,5'])
  for (const whole of integerParts) {
    for (const count of lengths) {
      const fragments = [
        '0'.repeat(count) + '1',
        '1'.repeat(count),
        '5' + '0'.repeat(count),
        '0'.repeat(count - 1) + '5',
        '9'.repeat(count),
      ]
      for (const tail of fragments) {
        unique.add(whole + ',' + tail)
        unique.add(whole + '.' + tail + '00')
      }
    }
  }
  return [...unique]
}

test('980+ independent synthetic Dutch-decimal candidates preserve their exact rational meaning or fail closed', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const {
      observationFinalPackAmount: parse,
      observationEditablePackAmount: show,
      observationPackAmountEditDecision: decide,
    } = await vite.ssrLoadModule('/src/features/observation/ObservationPackAmountInput.tsx')
    const texts = syntheticInputs()
    assert.ok(texts.length >= 980, 'sufficient broad decimal matrix: ' + texts.length)
    for (const text of texts) {
      const numeric = Number(text.replace(',', '.'))
      const canTrust = Number.isFinite(numeric) && numeric > 0 &&
        numeric <= Number.MAX_SAFE_INTEGER && sameDecimal(text, show(numeric))
      const result = parse(text)
      assert.equal(result, canTrust ? numeric : null, 'lossless rational input ' + text.slice(0, 65))
      assert.deepEqual(decide(text),
        canTrust ? { kind: 'accept', value: numeric } : { kind: 'reject' },
        'human observation may never be silently changed')
      if (canTrust) {
        assert.equal(parse(show(result)), result, 'focus/blur must be idempotent')
      }
    }
    for (const value of ['1e3', '-1', '1,', '1.', '1.000,20', 'NaN',
      'Infinity', '1\n2', '0', '00', '1/2', '١,٥', '1\u20282', '0x10']) {
      assert.equal(parse(value), null)
      assert.deepEqual(decide(value), { kind: 'reject' })
    }
    for (const value of [null, undefined, 1, {}, [], NaN]) {
      assert.equal(parse(value), null)
      assert.deepEqual(decide(value), { kind: 'reject' })
    }
    // Leading Unicode whitespace is deliberately trimmed by the text-input
    // parser, but the canonical saved value must contain no hidden glyph.
    assert.equal(parse('\u20281.5'), 1.5)
    assert.deepEqual(decide('\u20281.5'), { kind: 'accept', value: 1.5 })
    assert.equal(show(parse('\u20281.5')), '1,5')
    // An embedded separator is not removable at the field boundary.
    assert.equal(parse('1\u20282'), null)
    assert.deepEqual(decide('1\u20282'), { kind: 'reject' })
    assert.deepEqual(decide(''), { kind: 'accept', value: null },
      'user-initiated clearing is distinct from invalid input')
  } finally {
    await vite.close()
  }
})

test('actual input SSR retains Dutch decimal, accessible name, and no fabricated measured price', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { ObservationPackAmountInput } = await vite.ssrLoadModule(
      '/src/features/observation/ObservationPackAmountInput.tsx')
    const html = renderToStaticMarkup(createElement(ObservationPackAmountInput, {
      amount: 0.75,
      label: 'Gemeten verpakking: fictieve bloemkool',
      onAmountChange() {},
    }))
    assert.match(html, /inputMode="decimal"|inputMode=decimal|inputmode="decimal"/i)
    assert.match(html, /aria-label="Gemeten verpakking: fictieve bloemkool"/)
    assert.match(html, /value="0,75"/)
    assert.doesNotMatch(html, /€|savings|besparing|navigator\.clipboard/)
  } finally {
    await vite.close()
  }
})
