import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import {
  restoreShoppingListProgress, serializeShoppingListProgress,
  shoppingListBasketKey, shoppingListProgressStorageKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'

// Independent quality-validation of the real routed view after product #2592.
// Offline fixture only. No observed PLUS/DekaMarkt price or savings evidence.
function exampleBasket() {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  })
}

function usingStoredProgress(raw, render) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const calls = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem(key) {
          assert.equal(key, shoppingListProgressStorageKey)
          calls.push('get')
          if (raw instanceof Error) throw raw
          return raw
        },
        setItem() {
          calls.push('set')
          throw new Error('an SSR render must not persist checkmarks')
        },
      },
    },
  })
  try { return { html: render(), calls } } finally {
    if (original) Object.defineProperty(globalThis, 'window', original)
    else delete globalThis.window
  }
}

function countPhysicalPaperRows(html) {
  const list = /<ol class="supa-printable-shopping__rows">([\s\S]*?)<\/ol>/u.exec(html)?.[1]
  assert.ok(list, 'genuine printable full checklist must be present')
  return (list.match(/<li>/gu) ?? []).length
}

test('independent persisted-check filter keeps full paper/copy truth in the actual SSR view', async (t) => {
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'error',
  })
  try {
    const { ShoppingListView, shoppingVisibleLines } = await vite.ssrLoadModule(
      '/src/features/shopping-list/ShoppingListView.tsx',
    )
    const value = exampleBasket()
    const snapshot = structuredClone(value)
    const ids = value.lines.map((line) => line.id)
    assert.ok(ids.length >= 2, 'fixture must include two physical requirements')
    const paper = preparePrintableShoppingChecklist(value)
    assert.equal(paper.lines.length, ids.length)

    for (const [name, checked] of [
      ['nothing checked', []],
      ['two separate items checked', [ids[0], ids[ids.length - 1]]],
      ['everything checked', [...ids]],
    ]) {
      await t.test(name + ' uses restored checks but never filters physical exports', () => {
        const raw = serializeShoppingListProgress(value, checked)
        const restored = restoreShoppingListProgress(value, raw)
        assert.deepEqual(restored, checked)
        const beforeRaw = raw
        const originalCopy = buildShoppingListCopyText(value, restored)
        assert.equal(typeof originalCopy, 'string')
        assert.equal(shoppingListBasketKey(value), shoppingListBasketKey(snapshot))
        const openProjection = shoppingVisibleLines(value.lines, restored, true)
        assert.deepEqual(
          openProjection.map((line) => line.id),
          ids.filter((id) => !checked.includes(id)),
        )
        assert.ok(openProjection.every((line) => value.lines.includes(line)))
        assert.equal(shoppingVisibleLines(value.lines, restored, false).length, ids.length)

        const rendered = usingStoredProgress(raw, () =>
          renderToStaticMarkup(createElement(ShoppingListView, { basket: value })),
        )
        assert.deepEqual(rendered.calls, ['get'], 'SSR cannot write or reset persisted state')
        assert.match(rendered.html, /data-shopping-filter="all"/u)
        assert.match(rendered.html, /aria-pressed="false"/u)
        assert.match(rendered.html, /Alleen open/u)
        assert.ok(rendered.html.includes(
          String(ids.length - checked.length) + ' van ' + String(ids.length) + ' open',
        ))
        assert.equal(countPhysicalPaperRows(rendered.html), ids.length)
        assert.match(rendered.html, /Print boodschappenlijst/u)
        assert.match(rendered.html, /Toon kopieerbare lijst/u)
        assert.equal(buildShoppingListCopyText(value, restored), originalCopy)
        assert.equal(serializeShoppingListProgress(value, restored), beforeRaw)
        assert.deepEqual(value, snapshot)
      })
    }

    await t.test('stale basket keys cannot mark a physically changed basket as completed', () => {
      const raw = serializeShoppingListProgress(value, ids)
      const changed = structuredClone(value)
      const firstMatched = changed.lines.find((line) => line.status === 'matched')
      assert.ok(firstMatched, 'fixture must include a matched physical product')
      firstMatched.productId += '-changed-qa'
      assert.notEqual(shoppingListBasketKey(changed), shoppingListBasketKey(value))
      assert.deepEqual(restoreShoppingListProgress(changed, raw), [])
      const { html, calls } = usingStoredProgress(raw, () =>
        renderToStaticMarkup(createElement(ShoppingListView, { basket: changed })),
      )
      assert.deepEqual(calls, ['get'])
      assert.ok(html.includes(String(changed.lines.length) + ' van ' + String(changed.lines.length) + ' open'))
      assert.equal(countPhysicalPaperRows(html), changed.lines.length)
      assert.deepEqual(value, snapshot)
    })

    await t.test('switching physical stores cannot reuse the previous store checkmarks', () => {
      const raw = serializeShoppingListProgress(value, ids)
      const elsewhere = structuredClone(value)
      elsewhere.store.id += '-independent-store'
      assert.notEqual(shoppingListBasketKey(elsewhere), shoppingListBasketKey(value))
      assert.deepEqual(restoreShoppingListProgress(elsewhere, raw), [])
      const { html, calls } = usingStoredProgress(raw, () =>
        renderToStaticMarkup(createElement(ShoppingListView, { basket: elsewhere })),
      )
      assert.deepEqual(calls, ['get'])
      assert.ok(html.includes(String(ids.length) + ' van ' + String(ids.length) + ' open'))
      assert.equal(countPhysicalPaperRows(html), ids.length)
      assert.deepEqual(value, snapshot)
    })

    await t.test('denied saved-state read cannot remove rows, claim saved progress or leak diagnostics', () => {
      const denied = new Error('fictional-private-store-identifier')
      const { html, calls } = usingStoredProgress(denied, () =>
        renderToStaticMarkup(createElement(ShoppingListView, { basket: value })),
      )
      assert.deepEqual(calls, ['get'])
      assert.doesNotMatch(html, /fictional-private-store-identifier/u)
      assert.equal(countPhysicalPaperRows(html), ids.length)
      assert.ok(html.includes(String(ids.length) + ' van ' + String(ids.length) + ' open'))
      assert.match(html, /Print boodschappenlijst/u)
      assert.deepEqual(value, snapshot)
    })
  } finally {
    await vite.close()
  }
})
