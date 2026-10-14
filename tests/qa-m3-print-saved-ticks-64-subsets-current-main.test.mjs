import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import {
  serializeShoppingListProgress,
  shoppingListProgressStorageKey,
} from '../src/features/shopping-list/shoppingListProgress.ts'

// Independent QA on the *merged* shopping route. The data and names are
// controlled demo fixtures, never human M3 observations or retailer prices.
const base = buildOneStoreBasket({
  store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
  products: m2Products, activeDays: m2DefaultActiveDays,
})
assert.ok(base.lines.length >= 6)

function renderedPaper(html) {
  const match = /<ol class="supa-printable-shopping__rows">([\s\S]*?)<\/ol>/.exec(html)
  assert.ok(match, 'actual paper ordered list must render')
  return match[1]
}
function checkedCount(html) {
  return (html.match(/☑/g) ?? []).length
}
function liveCheckedCount(html) {
  return (html.match(/class="shopping-row checked(?:\s|")/g) ?? []).length
}
function printCheckedRows(html) {
  return checkedCount(renderedPaper(html))
}
function scopedRender(Component, basket, storage) {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const calls = { get: 0, set: 0 }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem(key) {
          calls.get++
          assert.equal(key, shoppingListProgressStorageKey)
          return storage
        },
        setItem() {
          calls.set++
          throw Error('Synthetic QA: SSR must never save')
        },
      },
    },
  })
  try {
    const html = renderToStaticMarkup(createElement(Component, { basket }))
    assert.equal(calls.get, 1, 'only the initial snapshot read is permitted')
    assert.equal(calls.set, 0, 'server-side rendering must never persist data')
    return html
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else delete globalThis.window
  }
}

test('independent current-main QA: routed saved ticks, paper and shopping rows agree for all 64 subsets', async (t) => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false }, appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  try {
    const { ShoppingListView } = await vite.ssrLoadModule('/src/features/shopping-list/ShoppingListView.tsx')
    const ids = base.lines.slice(0, 6).map(line => line.id)
    assert.equal(new Set(ids).size, 6)
    for (let mask = 0; mask < 64; mask++) {
      const selected = ids.filter((_, index) => Boolean(mask & (1 << index)))
      const raw = serializeShoppingListProgress(base, [...selected, ...selected, 'foreign-qa-row', null, 10])
      const before = structuredClone(base)
      const html = scopedRender(ShoppingListView, base, raw)
      const expected = selected.length
      const printed = renderedPaper(html)
      assert.equal(printCheckedRows(html), expected, `paper mask ${mask}`)
      assert.equal(liveCheckedCount(html), expected, `live list mask ${mask}`)
      assert.equal((printed.match(/<li>/g) ?? []).length, base.lines.length)
      assert.equal((printed.match(/☐/g) ?? []).length, base.lines.length - expected)
      assert.match(html, /Geen liveprijzen of besparingsbewijs/)
      assert.doesNotMatch(html, /€|priceCents|savingsCents|publicSavingsClaimEligible|participantKey|<script\b/i)
      assert.deepEqual(base, before, `source basket must remain unchanged, mask ${mask}`)
    }
    await t.test('current checked state never leaks into changed store, price, pack or demand', () => {
      const marked = [base.lines[0].id, base.lines[1].id]
      const raw = serializeShoppingListProgress(base, marked)
      const changed = [
        ['store', (b) => { b.store.id = 'different-demo-store' }],
        ['price', (b) => { b.lines[0].pricePerPackCents += 1; b.lines[0].lineTotalCents += 1; b.totalCents += 1 }],
        ['pack', (b) => { b.lines[0].pack.amount += 1 }],
        ['demand', (b) => { b.lines[0].requirement.amount += 1 }],
      ]
      for (const [name, update] of changed) {
        const basket = structuredClone(base)
        update(basket)
        const before = structuredClone(basket)
        const html = scopedRender(ShoppingListView, basket, raw)
        assert.equal(printCheckedRows(html), 0, `paper stale ${name}`)
        assert.equal(liveCheckedCount(html), 0, `live stale ${name}`)
        assert.match(html, /Geen liveprijzen of besparingsbewijs/)
        assert.deepEqual(basket, before)
      }
    })
    await t.test('unresolved but checked is never a purchased product or completed proof', () => {
      const basket = structuredClone(base)
      const line = basket.lines[0]
      line.status = 'unresolved'
      line.requirement = { amount: null, unit: 'unknown' }
      const raw = serializeShoppingListProgress(basket, [line.id])
      const html = scopedRender(ShoppingListView, basket, raw)
      assert.equal(printCheckedRows(html), 1)
      assert.equal(liveCheckedCount(html), 1)
      assert.match(renderedPaper(html), /hoeveelheid onbekend/)
      assert.match(renderedPaper(html), /handmatig kiezen/)
      assert.match(renderedPaper(html), /Product nog te kiezen/)
      assert.doesNotMatch(renderedPaper(html), /€|Besparing bewezen/i)
    })
    await t.test('malformed and future schema persisted records do not mark paper rows', () => {
      const ids = [base.lines[0].id]
      const good = JSON.parse(serializeShoppingListProgress(base, ids))
      for (const raw of [
        '{invalid', JSON.stringify({ ...good, schemaVersion: 2 }),
        JSON.stringify({ ...good, basketKey: 'foreign-qa-basket' }),
        JSON.stringify({ ...good, doneLineIds: 'not-an-array' }),
      ]) {
        const html = scopedRender(ShoppingListView, base, raw)
        assert.equal(printCheckedRows(html), 0)
        assert.equal(liveCheckedCount(html), 0)
      }
    })
  } finally {
    await vite.close()
  }
})
