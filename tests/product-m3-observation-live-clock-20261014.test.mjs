import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { validObservedAt } from '../src/domain/m3ObservationSheet.ts'

test('M3 clock treats a future absolute instant as future until the real instant arrives', () => {
  const referenceNow = Date.UTC(2026, 9, 14, 20, 0, 0)
  const futureAcrossOffset = '2026-10-14T22:00:30+02:00'
  assert.equal(validObservedAt(futureAcrossOffset, referenceNow), null)
  assert.equal(validObservedAt(futureAcrossOffset, referenceNow + 30_000), referenceNow + 30_000)
  assert.equal(validObservedAt(futureAcrossOffset, referenceNow + 60_000), referenceNow + 30_000)
  assert.equal(validObservedAt('2025-10-14T20:00:00Z', referenceNow), Date.UTC(2025, 9, 14, 20))
  assert.equal(validObservedAt(futureAcrossOffset, referenceNow - 1), null)
})

test('M3 field collector recalculates all three readiness consumers on one clock', () => {
  const source = readFileSync(
    new URL('../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8',
  )
  assert.match(source, /const \[referenceNowMs, setReferenceNowMs\] = useState\(\(\) => Date\.now\(\)\)/u)
  assert.match(source, /window\.setInterval\(refresh, 60_000\)/u)
  assert.match(source, /window\.addEventListener\('focus', refresh\)/u)
  assert.match(source, /document\.addEventListener\('visibilitychange', refresh\)/u)
  assert.match(source, /window\.clearInterval\(interval\)/u)
  assert.match(source, /window\.removeEventListener\('focus', refresh\)/u)
  assert.match(source, /document\.removeEventListener\('visibilitychange', refresh\)/u)
  for (const fn of [
    'observationNextAction',
    'observationSheetReadiness',
    'observationWindowSummary',
  ]) {
    assert.ok(source.includes(`${fn}(sheet, referenceNowMs)`),
      `${fn} must receive the same refreshed wall clock`)
  }
  assert.equal(source.includes('observationSheetReadiness(sheet, Date.now())'), false)
  assert.equal(source.includes('observationWindowSummary(sheet, Date.now())'), false)
})

test('current M3 field collection view remains server-renderable without a browser timer', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ObservationView } = await vite.ssrLoadModule(
      '/src/features/observation/ObservationView.tsx',
    )
    const html = renderToStaticMarkup(createElement(ObservationView))
    assert.match(html, /PLUS/u)
    assert.match(html, /DekaMarkt/u)
    assert.doesNotMatch(html, /NaN|Invalid Date/u)
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
    await vite.close()
  }
})
