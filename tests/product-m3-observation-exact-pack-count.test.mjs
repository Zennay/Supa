import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildObservationSheet, withObservedProductAvailability } from '../src/domain/m3ObservationSheet.ts'

test('M3 exact multipack input rejects truncation, exponent and fake defaults', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { ObservationPackCountInput, observationExactPackCount } =
      await vite.ssrLoadModule('/src/features/observation/ObservationPackCountInput.tsx')

    for (const [input, expected] of [
      ['1', 1], ['2', 2], ['0002', 2], ['7', 7],
      ['9007199254740991', Number.MAX_SAFE_INTEGER],
      ['2.9', null], ['2,9', null], ['1e2', null],
      ['0', null], ['-1', null], ['+', null], ['1.0', null],
      ['9007199254740992', null], ['Infinity', null],
      ['', null], [' ', null], ['1 000', null],
      ['NaN', null], [2, null], [null, null],
    ]) assert.equal(observationExactPackCount(input), expected)

    const markup = renderToStaticMarkup(createElement(ObservationPackCountInput, {
      count: 2,
      label: 'PLUS · rijst · aantal per verpakking',
      onCountChange: () => assert.fail('render must not fabricate observed counts'),
    }))
    assert.match(markup, /type="text"/)
    assert.match(markup, /inputMode="numeric"/)
    assert.match(markup, /value="2"/)
    assert.match(markup, /aria-label="PLUS · rijst · aantal per verpakking"/)
    assert.match(markup, /aria-invalid="false"/)
    assert.doesNotMatch(markup, /type="number"|besparing bewezen/)

    const screen = await readFile(
      new URL('../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8',
    )
    assert.match(screen, /<ObservationPackCountInput[\s\S]*?count=\{product\.packCount\}/)
    assert.match(screen, /onCountChange=\{\(packCount\) =>[\s\S]*?updateProduct\(side, lineIndex, \{ packCount \}\)/)
    assert.doesNotMatch(screen, /packCount:\s*observationPackCount\(/)
    const sheet = buildObservationSheet()
    const product = sheet.baseline.lines[0].observedProduct
    const selected = withObservedProductAvailability(product, true)
    assert.equal(selected.packCount, 1, 'original canonical empty draft still contains explicit default 1')
    assert.equal(observationExactPackCount('2.9'), null, 'fraction cannot replace that default')
  } finally {
    await vite.close()
  }
})
