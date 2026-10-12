import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import * as prefs from '../src/domain/plannerPreferences.ts'
import * as fixture from '../src/data/m2Fixture.ts'
import * as m3 from '../src/data/m3ComparisonFixture.ts'
import * as controller from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import * as demand from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import * as rows from '../src/features/shopping-list/shoppingListRowsV2.ts'
import * as progress from '../src/features/shopping-list/shoppingListProgressV2.ts'
import * as legacy from '../src/features/shopping-list/shoppingListProgress.ts'
import * as session from '../src/features/shopping-list/shoppingListProgressSessionV2.ts'

// Product-core #1056: the real compiled App routes to the actual compiled
// ShoppingListViewV2 event handlers. All money uses disposable M2 fixtures.
// These are deterministic hook/storage doubles, NOT browser/VPS/M3 evidence.
const nodeRequire = createRequire(import.meta.url)
const jsxRuntime = nodeRequire('react/jsx-runtime')
const pack = (file, resolver) => {
  const compiled = ts.transpileModule(
    readFileSync(new URL(file, import.meta.url), 'utf8'), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
      reportDiagnostics: true,
    },
  )
  assert.deepEqual(compiled.diagnostics, [])
  const out = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    out, out.exports, resolver,
  )
  return out.exports
}

function scheduler() {
  const slots = []
  let cursor = 0
  let effects = []
  return {
    hooks: {
      useMemo: (fn) => fn(),
      useState(initial) {
        const index = cursor++
        if (!(index in slots)) {
          slots[index] = typeof initial === 'function' ? initial() : initial
        }
        return [slots[index], (next) => {
          slots[index] = typeof next === 'function' ? next(slots[index]) : next
        }]
      },
      useEffect: (fn) => effects.push(fn),
    },
    begin() { cursor = 0; effects = [] },
    reset() { slots.length = 0; cursor = 0; effects = [] },
    flush() { for (const fn of [...effects]) fn() },
  }
}

const appHooks = scheduler()
const shoppingHooks = scheduler()
const ShoppingListViewV2 = pack(
  '../src/features/shopping-list/ShoppingListViewV2.tsx',
  (name) => {
    if (name === 'react') return shoppingHooks.hooks
    if (name === 'react/jsx-runtime') return jsxRuntime
    if (name === './shoppingListDemandIdentity.ts') return demand
    if (name === './shoppingListRowsV2.ts') return rows
    if (name === './shoppingListStorageControllerV2.ts') return controller
    return nodeRequire(name)
  },
).ShoppingListViewV2
const fakeViews = {
  PlannerView: () => null, BasketView: () => null, ObservationView: () => null,
}
const modules = {
  './features/planner/PlannerView': { PlannerView: fakeViews.PlannerView },
  './features/basket/BasketView': { BasketView: fakeViews.BasketView },
  './features/shopping-list/ShoppingListViewV2': { ShoppingListViewV2 },
  './features/observation/ObservationView': { ObservationView: fakeViews.ObservationView },
  './domain/basket': { buildOneStoreBasket },
  './domain/basketComparison': { compareFullBaskets },
  './domain/plannerPreferences': prefs,
  './data/m2Fixture': fixture,
  './data/m3ComparisonFixture': m3,
}
const App = pack('../src/App.tsx', (name) => {
  if (name === 'react') return appHooks.hooks
  if (name === 'react/jsx-runtime') return jsxRuntime
  if (Object.hasOwn(modules, name)) return modules[name]
  return nodeRequire(name)
}).App

function walk(node) {
  if (Array.isArray(node)) return node.flatMap(walk)
  if (node === null || typeof node !== 'object' || !('props' in node)) return []
  return [node, ...walk(node.props.children)]
}
const elements = (node, predicate) => walk(node).filter(predicate)
const buttons = (tree) => elements(tree, (node) =>
  node.type === 'button' && typeof node.props.className === 'string' &&
  node.props.className.includes('shopping-row'))
const view = (basket) => {
  shoppingHooks.begin()
  const tree = ShoppingListViewV2({ basket })
  return { tree, rows: buttons(tree), flush: () => shoppingHooks.flush() }
}
function appRender() {
  appHooks.begin()
  return App()
}
function goTo(tree, label) {
  const nav = elements(tree, (n) => n.type === 'nav')[0]
  assert.ok(nav)
  const button = elements(nav, (n) => n.type === 'button')
    .find((b) => b.props.children === label)
  assert.ok(button, 'real App navigation has ' + label)
  button.props.onClick()
  return appRender()
}
function activeBasket(tree) {
  const routed = elements(tree, (n) => n.type === ShoppingListViewV2)
  assert.equal(routed.length, 1, 'Lijst must mount actual v2 view')
  assert.equal(routed[0].props.allowLegacyUpgrade, undefined)
  return routed[0].props.basket
}
function storageSession() {
  // Each synthetic mount uses fresh component hook slots and browser storage.
  appHooks.reset()
  shoppingHooks.reset()
  const old = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const saved = new Map()
  const writes = []
  const reads = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: {
      getItem(key) { reads.push(key); return saved.get(key) ?? null },
      setItem(key, value) { writes.push({ key, value }); saved.set(key, value) },
    },
  } })
  return {
    saved, writes, reads,
    close() {
      if (old) Object.defineProperty(globalThis, 'window', old)
      else delete globalThis.window
    },
  }
}

test('product #1056: App Lijst routes real v2 click with no implicit legacy read', () => {
  const browser = storageSession()
  try {
    let screen = appRender()
    screen = goTo(screen, 'Lijst')
    const basket = activeBasket(screen)
    const first = view(basket)
    assert.equal(first.rows.length, basket.lines.length)
    assert.ok(first.rows.length >= 2)
    assert.ok(first.rows.every((b) => b.props['aria-pressed'] === false))
    assert.deepEqual(browser.writes, [])
    assert.deepEqual(
      browser.reads.filter((key) => key.startsWith('supa:shopping-list-progress:')),
      [progress.shoppingListProgressV2StorageKey],
      'App may read its own planner key, but the v2 list must not read v1',
    )
    first.flush()
    assert.deepEqual(browser.writes, [], 'mount must be read only')
    const checkedId = basket.lines[0].id
    first.rows[0].props.onClick()
    assert.equal(browser.writes.length, 1)
    assert.equal(browser.writes[0].key, progress.shoppingListProgressV2StorageKey)
    const after = view(basket)
    assert.equal(after.rows[0].props['aria-pressed'], true)
    assert.equal(browser.saved.get(legacy.shoppingListProgressStorageKey), undefined)
    const record = JSON.parse(browser.saved.get(progress.shoppingListProgressV2StorageKey))
    assert.ok(JSON.stringify(record).includes(checkedId))
  } finally { browser.close() }
})

test('product #1056: routed v2 keeps clicked physical row after price-only refresh', () => {
  const browser = storageSession()
  try {
    const screen = goTo(appRender(), 'Lijst')
    const basket = activeBasket(screen)
    const first = view(basket)
    first.flush()
    const riceIndex = basket.lines.findIndex((line) => line.id === 'basmati-rice')
    assert.ok(riceIndex >= 0)
    first.rows[riceIndex].props.onClick()
    assert.equal(view(basket).rows[riceIndex].props['aria-pressed'], true)
    const saved = browser.saved.get(progress.shoppingListProgressV2StorageKey)
    const changedProducts = fixture.m2Products.map((item) => item.id === 'basmati-1kg'
      ? { ...item, priceCents: item.priceCents + 1 }
      : item)
    const changed = buildOneStoreBasket({
      store: fixture.m2Store,
      plan: fixture.m2InitialPlan,
      recipes: fixture.m2Recipes,
      activeDays: prefs.defaultPlannerPreferences(fixture.m2InitialPlan).activeDays,
      products: changedProducts,
    })
    assert.notEqual(changed.totalCents, basket.totalCents)
    assert.equal(demand.shoppingListDemandIdentity(changed), demand.shoppingListDemandIdentity(basket))
    const refreshed = view(changed)
    assert.equal(refreshed.rows[riceIndex].props['aria-pressed'], true)
    refreshed.flush()
    assert.equal(view(changed).rows[riceIndex].props['aria-pressed'], true)
    assert.equal(browser.saved.get(progress.shoppingListProgressV2StorageKey), saved)
    assert.equal(browser.writes.length, 1, 'price refresh alone never writes storage')
  } finally { browser.close() }
})

test('product #1056: real Planner day toggle changes physical demand and clears old v2 checks', () => {
  const browser = storageSession()
  try {
    let screen = goTo(appRender(), 'Lijst')
    const original = activeBasket(screen)
    const originalIdentity = demand.shoppingListDemandIdentity(original)
    const first = view(original)
    first.flush()
    const riceIndex = original.lines.findIndex((line) => line.id === 'basmati-rice')
    assert.ok(riceIndex >= 0)
    first.rows[riceIndex].props.onClick()
    assert.equal(view(original).rows[riceIndex].props['aria-pressed'], true)
    const priorSaved = browser.saved.get(progress.shoppingListProgressV2StorageKey)
    assert.ok(priorSaved)

    screen = goTo(screen, 'Planner')
    const planner = elements(screen, (n) => n.type === fakeViews.PlannerView)
    assert.equal(planner.length, 1)
    assert.ok(planner[0].props.activeDays.includes('Ma'))
    planner[0].props.onToggleDay('Ma')
    screen = goTo(appRender(), 'Lijst')
    const changed = activeBasket(screen)
    assert.ok(changed.lines.length > 0, 'other active days still need a basket')
    assert.notEqual(
      demand.shoppingListDemandIdentity(changed), originalIdentity,
      'changing planned meals changes the physical shopping round',
    )
    const firstNew = view(changed)
    firstNew.flush()
    const after = view(changed)
    assert.ok(after.rows.every((button) => button.props['aria-pressed'] === false))
    assert.notEqual(browser.saved.get(progress.shoppingListProgressV2StorageKey), priorSaved)
    assert.equal(browser.saved.get(legacy.shoppingListProgressStorageKey), undefined)
  } finally { browser.close() }
})

test('product #1056: returning to Lijst remounts saved checkmarks without rewriting v1 or v2', () => {
  const browser = storageSession()
  try {
    let screen = goTo(appRender(), 'Lijst')
    const basket = activeBasket(screen)
    const riceIndex = basket.lines.findIndex((line) => line.id === 'basmati-rice')
    assert.ok(riceIndex >= 0)
    const first = view(basket)
    first.flush()
    first.rows[riceIndex].props.onClick()
    const saved = browser.saved.get(progress.shoppingListProgressV2StorageKey)
    assert.ok(saved, 'intentional check has a durable v2 representation')
    assert.equal(view(basket).rows[riceIndex].props['aria-pressed'], true)
    assert.equal(browser.writes.length, 1)

    // Real navigation changes destination. React unmounts the old v2 view;
    // clear only that view's hook slots to emulate a new mounting instance.
    screen = goTo(screen, 'Mand')
    assert.equal(elements(screen, (n) => n.type === ShoppingListViewV2).length, 0)
    shoppingHooks.reset()
    screen = goTo(screen, 'Lijst')
    const restored = view(activeBasket(screen))
    assert.equal(restored.rows[riceIndex].props['aria-pressed'], true)
    restored.flush()
    assert.equal(view(activeBasket(screen)).rows[riceIndex].props['aria-pressed'], true)
    assert.equal(browser.writes.length, 1, 'returning is read-only until a new click')
    assert.equal(browser.saved.get(progress.shoppingListProgressV2StorageKey), saved)
    assert.equal(browser.saved.get(legacy.shoppingListProgressStorageKey), undefined)
    assert.equal(
      browser.reads.filter((key) => key === legacy.shoppingListProgressStorageKey).length,
      0, 'legacy v1 is never implicitly consulted',
    )
  } finally { browser.close() }
})
