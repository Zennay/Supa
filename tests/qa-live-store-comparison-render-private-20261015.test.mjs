import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildFictionalPricedSheet } from '../scripts/m3-rehearse-field-run.mjs'
import { OBSERVATION_DRAFT_STORAGE_KEY } from '../src/domain/m3ObservationSheet.ts'

const withWindow = async (value, fn) => {
  const existing = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    if (value === null) delete globalThis.window
    else Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value,
    })
    return await fn()
  } finally {
    if (existing) Object.defineProperty(globalThis, 'window', existing)
    else delete globalThis.window
  }
}

test('rendered Vergelijk has no fake retailer prices, private data or winner on empty local storage', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  try {
    const { ObservedStoreComparisonView } = await vite.ssrLoadModule(
      '/src/features/comparison/ObservedStoreComparisonView.tsx',
    )
    await withWindow(null, () => {
      const html = renderToStaticMarkup(createElement(ObservedStoreComparisonView, {
        onOpenObservation: () => {},
      }))
      assert.match(html, /PLUS vs DekaMarkt/u)
      assert.match(html, /Nog geen winkelprijzen ingevoerd/u)
      assert.match(html, /Prijzen invullen in Meten/u)
      assert.match(html, /data-comparison-ready="false"/u)
      assert.doesNotMatch(html, /data-observed-row-delta|DekaMarkt is .*goedkoper|PLUS is .*goedkoper/u)
      assert.doesNotMatch(html, /fictional-operator-key|voorbeeldmandje|NaN|Infinity/u)
    })
  } finally {
    await vite.close()
  }
})

test('rendered Vergelijk uses read-only saved full 11+11 observation; no template amounts, unsafe markup or identity disclosure', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const sheet = buildFictionalPricedSheet(90)
  const badMarkup = '<img src=x onerror=alert(1)>'
  const originalName = sheet.candidate.lines[0].observedProduct.productName
  sheet.candidate.lines[0].observedProduct.productName = originalName + badMarkup
  const stored = JSON.stringify(sheet)
  const calls = []
  const fakeWindow = {
    localStorage: {
      getItem: (key) => {
        calls.push(key)
        return key === OBSERVATION_DRAFT_STORAGE_KEY ? stored : null
      },
      setItem: () => { throw Error('comparison must never save observations') },
      removeItem: () => { throw Error('comparison must never erase observations') },
    },
  }
  try {
    const { ObservedStoreComparisonView } = await vite.ssrLoadModule(
      '/src/features/comparison/ObservedStoreComparisonView.tsx',
    )
    await withWindow(fakeWindow, () => {
      const html = renderToStaticMarkup(createElement(ObservedStoreComparisonView, {
        onOpenObservation: () => {},
      }))
      assert.match(html, /data-comparison-ready="true"/u)
      assert.match(html, /DekaMarkt is .*1,10.*goedkoper/u)
      assert.match(html, /data-store="plus"/u)
      assert.match(html, /data-store="dekamarkt"/u)
      assert.equal((html.match(/data-ingredient-id=/gu) ?? []).length, 11)
      assert.equal((html.match(/data-observed-row-delta/gu) ?? []).length, 11)
      assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/u)
      assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/u)
      assert.doesNotMatch(html, /fictional-operator-key|fictional-rehearsal-only/u)
      assert.doesNotMatch(html, /NaN|Infinity/u)
    })
    assert.deepEqual(calls, [OBSERVATION_DRAFT_STORAGE_KEY])
    assert.equal(JSON.stringify(sheet), stored)
  } finally {
    await vite.close()
  }
})

test('rendered Vergelijk fails closed for unreadable prior local data without overwriting it', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const fakeWindow = {
    localStorage: {
      getItem: () => '{malformed-private-data',
      setItem: () => { throw Error('unrecognized observations must be preserved') },
      removeItem: () => { throw Error('unrecognized observations must be preserved') },
    },
  }
  try {
    const { ObservedStoreComparisonView } = await vite.ssrLoadModule(
      '/src/features/comparison/ObservedStoreComparisonView.tsx',
    )
    await withWindow(fakeWindow, () => {
      const html = renderToStaticMarkup(createElement(ObservedStoreComparisonView, {
        onOpenObservation: () => {},
      }))
      assert.match(html, /data-comparison-ready="false"/u)
      assert.match(html, /Het bestaande lokale meetconcept kan niet veilig worden gelezen/u)
      assert.match(html, /Prijzen invullen in Meten/u)
      assert.doesNotMatch(html, /malformed-private-data/u)
    })
  } finally {
    await vite.close()
  }
})

test('actual saved localStorage rejects malformed extra physical line before rendering a winner', async () => {
  const vite = await createServer({
    server: { middlewareMode: true }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const sheet = buildFictionalPricedSheet(90)
  sheet.candidate.lines.push({
    ...sheet.candidate.lines[0],
    ingredientId: 'injected-12th-item',
  })
  const original = JSON.stringify(sheet)
  const fakeWindow = {
    localStorage: {
      getItem: () => original,
      setItem: () => { throw Error('corrupted evidence must not be overwritten') },
      removeItem: () => { throw Error('corrupted evidence must not be discarded') },
    },
  }
  try {
    const { ObservedStoreComparisonView } = await vite.ssrLoadModule(
      '/src/features/comparison/ObservedStoreComparisonView.tsx',
    )
    await withWindow(fakeWindow, () => {
      const html = renderToStaticMarkup(createElement(ObservedStoreComparisonView, {
        onOpenObservation: () => {},
      }))
      assert.match(html, /data-comparison-ready="false"/u)
      assert.match(html, /kan niet veilig worden gelezen/u)
      assert.doesNotMatch(html, /DekaMarkt is .*goedkoper/u)
      assert.doesNotMatch(html, /injected-12th-item/u)
    })
    assert.equal(JSON.stringify(sheet), original)
  } finally {
    await vite.close()
  }
})
