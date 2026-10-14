import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildObservationSheet, observationLineCollectionComplete } from '../src/domain/m3ObservationSheet.ts'
import { observationVisibleRows } from '../src/features/observation/observationVisibleRows.ts'

test('M3 open-lines filter preserves 11+11 real evidence and original update indices', () => {
  const sheet = buildObservationSheet()
  const original = structuredClone(sheet)
  const baseline = sheet.baseline
  const all = observationVisibleRows(baseline, false)
  assert.equal(all.length, 11)
  assert.deepEqual(all.map(({ lineIndex }) => lineIndex), Array.from({ length: 11 }, (_, i) => i))
  assert.strictEqual(all[5].line, baseline.lines[5])

  baseline.lines[0].observedProduct.available = false
  baseline.lines[3].observedProduct.available = false
  assert.equal(observationLineCollectionComplete(baseline.lines[0]), true)
  const open = observationVisibleRows(baseline, true)
  assert.equal(open.length, 9)
  assert.deepEqual(open.map(({ lineIndex }) => lineIndex), [1, 2, 4, 5, 6, 7, 8, 9, 10])
  assert.strictEqual(open[2].line, baseline.lines[4],
    'filtered UI index 2 must write to canonical observation line 4')
  assert.equal(observationVisibleRows(sheet.candidate, true).length, 11,
    'filter never copies or changes an independent store')
  assert.equal(observationVisibleRows(baseline, false).length, 11,
    'switching back restores previously completed rows')
  assert.deepEqual(sheet.baseline.lines[4], original.baseline.lines[4])
  assert.equal(sheet.evidenceStatus, 'collection-template-not-evidence')
})

test('real Meten screen exposes opt-in filter, with all M3 rows visible initially', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ObservationView } = await vite.ssrLoadModule('/src/features/observation/ObservationView.tsx')
    const html = renderToStaticMarkup(createElement(ObservationView))
    assert.match(html, /data-observation-open-lines-toggle/)
    assert.match(html, /aria-pressed="false"/)
    assert.match(html, /Toon alleen open regels/)
    assert.match(html, /Dit filter verandert geen meetgegevens/)
    assert.equal((html.match(/data-observation-line="/g) || []).length, 22)
    assert.match(html, /0\/22 regels compleet/)
    assert.doesNotMatch(html, /besparing bewezen|klaar voor publicatie/)

    const source = await readFile(
      new URL('../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8',
    )
    assert.match(source, /setShowOnlyOpenLines\(\(current\) => !current\)/)
    assert.match(source, /observationVisibleRows\(observation, showOnlyOpenLines\)\.map\(\(\{ line, lineIndex \}\)/)
    assert.match(source, /updateProduct\(side, lineIndex/)
    assert.doesNotMatch(source, /setSheet\(.*showOnlyOpenLines/)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
    await vite.close()
  }
})
