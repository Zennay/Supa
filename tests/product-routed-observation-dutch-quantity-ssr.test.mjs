import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildObservationSheet } from '../src/domain/m3ObservationSheet.ts'

test('actual routed Meten collector presents Dutch amounts but preserves canonical schema values', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const source = await readFile(new URL('../src/features/observation/ObservationView.tsx', import.meta.url), 'utf8')
  assert.match(app, /ObservationView/)
  assert.match(source, /<ObservationRequirementText\s+amount=\{line\.requirement\.amount\}/)
  assert.match(source, /<ObservationPackUnitOptions \/>/)
  assert.doesNotMatch(source, /packUnits\.map/)

  const vite = await createServer({
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    delete globalThis.window
    const { ObservationView } = await vite.ssrLoadModule('/src/features/observation/ObservationView.tsx')
    const sheet = buildObservationSheet()
    const snapshot = structuredClone(sheet)
    const html = renderToStaticMarkup(createElement(ObservationView))
    assert.match(html, /M3 · echte winkelobservatie/)
    assert.match(html, /nodig: 1 stuk|nodig: [2-9] stuks/)
    assert.doesNotMatch(html, /nodig: \d+ piece/)
    assert.equal((html.match(/<option value="piece">stuk<\/option>/g) ?? []).length, 22,
      'each of the 11 baseline and 11 candidate collection lines has one localized selector')
    assert.doesNotMatch(html, />piece<\/option>/)
    assert.match(html, /collection-template-not-evidence/)
    assert.deepEqual(sheet, snapshot)
    assert.ok(sheet.baseline.lines.every(line => line.observedProduct.available === null))
    assert.ok(sheet.candidate.lines.every(line => line.observedProduct.available === null))
    assert.ok(sheet.baseline.lines.some(line => line.requirement.unit === 'piece'))
    assert.equal(sheet.baseline.lines.length, 11)
    assert.equal(sheet.candidate.lines.length, 11)
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else delete globalThis.window
    await vite.close()
  }
})
