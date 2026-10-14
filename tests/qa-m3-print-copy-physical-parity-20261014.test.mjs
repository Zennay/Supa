import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'
import { preparePrintableShoppingChecklist } from '../src/features/shopping-list/printableShoppingChecklist.ts'
import { serializeShoppingListProgress, shoppingListProgressStorageKey } from '../src/features/shopping-list/shoppingListProgress.ts'

// All store names, prices and quantities are synthetic; these comparisons are
// NOT retailer observations or human M3 savings evidence.
function oneLine({
  need = 0.3, unit = 'kg', perItem = 100, packUnit = 'g',
  count = 1, packs = 3, status = 'matched', price = 219,
} = {}) {
  const match = {
    id: 'rice', ingredientLabel: 'Basmati rijst',
    requirement: { amount: need, unit }, status,
    productId: 'rice-box', productName: 'Basmati rijst',
    pack: { amount: perItem, unit: packUnit, count },
    packs, pricePerPackCents: price, lineTotalCents: packs * price,
    matchScore: 100, reasons: [],
  }
  return {
    store: { id: 'synthetic-qa-store', name: 'Voorbeeldwinkel QA' },
    selectedMealCount: 1,
    lines: [match],
    matchedLineCount: status === 'matched' ? 1 : 0,
    unresolvedLineCount: status === 'unresolved' ? 1 : 0,
    totalCents: status === 'matched' ? packs * price : 0,
  }
}
const cases = [
  [0.3, 'kg', 100, 'g', 1, 3],
  [0.6, 'kg', 200, 'g', 1, 3],
  [0.75, 'kg', 250, 'g', 2, 2],
  [1.25, 'kg', 250, 'g', 2, 3],
  [0.3, 'g', 0.1, 'g', 1, 3],
  [0.07, 'g', 0.035, 'g', 1, 2],
  [0.0700001, 'g', 0.035, 'g', 1, 3],
  [0.35, 'l', 175, 'ml', 1, 2],
  [0.6, 'l', 0.2, 'l', 2, 2],
  [1.75, 'l', 250, 'ml', 2, 4],
  [0.6, 'ml', 0.2, 'ml', 1, 3],
  [5, 'piece', 2, 'piece', 2, 2],
  [3, 'piece', 2, 'piece', 2, 1],
  [1, 'piece', 1, 'piece', 1, 1],
]
function contentRow(text) {
  return text.split('\n').find(line => line.startsWith('[x] ') || line.startsWith('[ ] '))
}
function assertNoMoney(str) {
  assert.doesNotMatch(str, /€|savingsCents|priceCents|lineTotalCents|prijsverschil|besparing/i)
}

test('QA: both independent portable and paper exports agree at 14 exact physical boundaries and completion states', () => {
  let observed = 0
  for (const [need, unit, perItem, packUnit, count, packs] of cases) {
    for (const completed of [false, true]) {
      const basket = oneLine({ need, unit, perItem, packUnit, count, packs })
      const before = structuredClone(basket)
      const printable = preparePrintableShoppingChecklist(basket)
      const copied = buildShoppingListCopyText(basket, completed ? ['rice'] : [])
      assert.equal(printable.lines.length, 1)
      assert.equal(printable.lines[0].needsReview, false,
        `print should trust minimal physical pack ${JSON.stringify([need, unit, perItem, packUnit, count, packs])}`)
      assert.equal(printable.reviewCount, 0)
      assert.ok(copied, 'copy should trust the same exact physical pack boundary')
      const row = contentRow(copied)
      assert.ok(row, 'copy must include the one physical task')
      assert.ok(row.startsWith(completed ? '[x] ' : '[ ] '))
      assert.match(row, /Basmati rijst/)
      assert.match(printable.lines[0].quantity, new RegExp('^' + packs + '(?: ×| verpakking)'))
      assert.match(row, new RegExp(' — ' + packs + ' × '))
      assertNoMoney(copied)
      assertNoMoney(JSON.stringify(printable))
      assert.deepEqual(basket, before)
      observed++
    }
  }
  assert.equal(observed, 28)
})

test('QA: physical under-purchase and wasteful extra-purchase disagree with neither export', () => {
  let observed = 0
  for (const [need, unit, perItem, packUnit, count, packs] of cases) {
    for (const stalePacks of [packs - 1, packs + 1]) {
      if (stalePacks < 1) continue
      const basket = oneLine({
        need, unit, perItem, packUnit, count, packs: stalePacks,
      })
      const before = structuredClone(basket)
      const printable = preparePrintableShoppingChecklist(basket)
      const copied = buildShoppingListCopyText(basket, ['rice'])
      assert.equal(copied, null, 'a copied task must never order stale packs')
      assert.equal(printable.lines[0].needsReview, true,
        'paper task must never order stale packs as authoritative')
      assert.match(printable.lines[0].quantity, /handmatig kiezen/)
      assert.equal(printable.reviewCount, 1)
      assert.deepEqual(basket, before)
      observed++
    }
  }
  assert.ok(observed >= 25)
})

test('QA: mass-to-volume family drift cannot manufacture a portable or paper purchase', () => {
  let tested = 0
  for (const [need, unit, perItem, packUnit, count, packs] of cases) {
    if (unit === 'piece') continue
    const switched = unit === 'g' || unit === 'kg' ? 'ml' : 'g'
    const basket = oneLine({ need, unit, perItem, packUnit: switched, count, packs })
    assert.equal(buildShoppingListCopyText(basket), null)
    const print = preparePrintableShoppingChecklist(basket)
    assert.equal(print.reviewCount, 1)
    assert.equal(print.lines[0].needsReview, true)
    tested++
  }
  assert.ok(tested >= 10)
})

test('QA: price-only catalog churn changes neither export physical text nor checkbox promise', () => {
  const original = oneLine()
  const changed = oneLine({ price: 99999 })
  assert.notEqual(original.lines[0].lineTotalCents, changed.lines[0].lineTotalCents)
  for (const doneIds of [[], ['rice']]) {
    assert.equal(buildShoppingListCopyText(original, doneIds), buildShoppingListCopyText(changed, doneIds))
    assert.deepEqual(preparePrintableShoppingChecklist(original), preparePrintableShoppingChecklist(changed))
  }
})

test('QA: routed SSR keeps copy selectable, never invokes privileged clipboard, while paper shows current stored tick', async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] }, logLevel: 'error',
  })
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const basket = oneLine()
  const stored = serializeShoppingListProgress(basket, ['rice'])
  let reads = 0
  try {
    const { ShoppingListView } = await vite.ssrLoadModule('/src/features/shopping-list/ShoppingListView.tsx')
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem(key) {
            assert.equal(key, shoppingListProgressStorageKey)
            reads++
            return stored
          },
          setItem() { throw Error('SSR unexpectedly attempted local write') },
        },
        navigator: { clipboard: {
          writeText() { throw Error('privileged clipboard called') },
        } },
      },
    })
    const html = renderToStaticMarkup(createElement(ShoppingListView, { basket }))
    assert.equal(reads, 1)
    assert.match(html, /Toon kopieerbare lijst/)
    assert.match(html, /class="shopping-copy__button"[^>]*aria-expanded="false"/)
    assert.doesNotMatch(html, /<textarea|€|priceCents|savingsCents|<script\b/i)
    assert.equal((html.match(/☑/g) ?? []).length, 1)
    assert.equal((html.match(/class="shopping-row checked(?:\s|")/g) ?? []).length, 1)
    assert.match(html, /Geen liveprijzen of besparingsbewijs/)
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
    await vite.close()
  }
})
