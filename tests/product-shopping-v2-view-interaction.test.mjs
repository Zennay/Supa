import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'
import {
  shoppingListProgressStorageKey, serializeShoppingListProgress,
} from '../src/features/shopping-list/shoppingListProgress.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { isTrustworthyShoppingBasket } from '../src/features/shopping-list/shoppingListPhysicalValidity.ts'
import {
  reconcileTrustedShoppingProgressV2, restoreTrustedShoppingProgressV2,
  serializeTrustedShoppingProgressV2, toggleTrustedShoppingProgressV2,
  upgradeTrustedLegacyProgressV1,
} from '../src/features/shopping-list/shoppingListTrustedProgressV2.ts'

// Transpile the ACTUAL production JSX, with a deterministic minimal hook/render
// harness. It exercises event handlers, effects, re-renders and storage without
// requiring a browser or reimplementing the View's business rules.
const source = readFileSync(new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'ShoppingListView.tsx',
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])

function basket({ store = m2Store, products = m2Products } = {}) {
  return buildOneStoreBasket({
    store, products,
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
  })
}

function storage(initial = []) {
  const data = new Map(initial)
  return {
    data,
    getItem(key) { return data.has(key) ? data.get(key) : null },
    setItem(key, value) { data.set(key, String(value)) },
  }
}

function makeHarness(initialBasket, localStorage) {
  const savedWindow = globalThis.window
  globalThis.window = { localStorage }
  const state = []
  const priorDeps = []
  let basketInput = initialBasket
  let cursor = 0
  let effects = []
  let dirty = false
  const createNode = (type, props) => ({ type, props })

  const react = {
    useMemo(calculate) { cursor++; return calculate() },
    useState(initial) {
      const slot = cursor++
      if (!Object.hasOwn(state, slot)) {
        state[slot] = typeof initial === 'function' ? initial() : initial
      }
      return [state[slot], (next) => {
        state[slot] = typeof next === 'function' ? next(state[slot]) : next
        dirty = true
      }]
    },
    useEffect(effect, deps) {
      const slot = cursor++
      if (!priorDeps[slot] || deps.some((value, index) => value !== priorDeps[slot][index])) {
        priorDeps[slot] = deps
        effects.push(effect)
      }
    },
  }
  const modules = {
    react,
    'react/jsx-runtime': { jsx: createNode, jsxs: createNode },
    './shoppingListDemandIdentity.ts': { shoppingListDemandIdentity },
    './shoppingListPhysicalValidity.ts': { isTrustworthyShoppingBasket },
    './shoppingListProgressV2.ts': { shoppingListProgressV2StorageKey },
    './shoppingListTrustedProgressV2.ts': {
      reconcileTrustedShoppingProgressV2, restoreTrustedShoppingProgressV2,
      serializeTrustedShoppingProgressV2, toggleTrustedShoppingProgressV2,
      upgradeTrustedLegacyProgressV1,
    },
    './shoppingListProgress': { shoppingListProgressStorageKey },
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, (name) => {
      if (!Object.hasOwn(modules, name)) throw new Error('unexpected view import: ' + name)
      return modules[name]
    },
  )
  const ShoppingListView = module.exports.ShoppingListView

  function render() {
    globalThis.window = { localStorage }
    for (let iteration = 0; iteration < 8; iteration++) {
      dirty = false
      cursor = 0
      effects = []
      const tree = ShoppingListView({ basket: basketInput })
      for (const effect of effects) effect()
      if (!dirty) return tree
    }
    throw new Error('ShoppingListView failed to settle its effects')
  }
  function buttons(root) {
    const nodes = []
    function visit(node) {
      if (Array.isArray(node)) return node.forEach(visit)
      if (!node || typeof node !== 'object') return
      if (node.type === 'button' && typeof node.props?.onClick === 'function') nodes.push(node)
      visit(node.props?.children)
    }
    visit(root)
    return nodes
  }
  return {
    render, buttons,
    setBasket(next) { basketInput = next; return render() },
    dispose() {
      if (savedWindow === undefined) delete globalThis.window
      else globalThis.window = savedWindow
    },
  }
}

test('real ShoppingListView: checked rows survive a valid price-only refresh and reload', (t) => {
  const saved = storage()
  const initial = basket()
  const chosen = initial.lines[0]
  assert.equal(chosen.status, 'matched')
  const ui = makeHarness(initial, saved)
  t.after(() => ui.dispose())
  const first = ui.buttons(ui.render())
  assert.ok(first.length > 0)
  assert.equal(first[0].props.type, 'button')
  assert.equal(first[0].props['aria-pressed'], false)
  first[0].props.onClick()
  assert.equal(ui.buttons(ui.render())[0].props['aria-pressed'], true)
  assert.equal(saved.data.has(shoppingListProgressStorageKey), false)
  assert.ok(saved.data.has(shoppingListProgressV2StorageKey))

  const priced = m2Products.map((item) =>
    item.id === chosen.productId ? { ...item, priceCents: item.priceCents + 1 } : item)
  const refreshed = basket({ products: priced })
  assert.ok(refreshed.totalCents !== initial.totalCents)
  assert.equal(shoppingListDemandIdentity(initial), shoppingListDemandIdentity(refreshed))
  assert.equal(ui.buttons(ui.setBasket(refreshed))[0].props['aria-pressed'], true)
  assert.deepEqual(restoreTrustedShoppingProgressV2(
    refreshed, saved.data.get(shoppingListProgressV2StorageKey)), [chosen.id])

  const reloaded = makeHarness(refreshed, saved)
  t.after(() => reloaded.dispose())
  assert.equal(reloaded.buttons(reloaded.render())[0].props['aria-pressed'], true)
})

test('real ShoppingListView: store and product changes clear previously checked items', (t) => {
  const saved = storage()
  const source = basket()
  const ui = makeHarness(source, saved)
  t.after(() => ui.dispose())
  ui.buttons(ui.render())[0].props.onClick()
  ui.render()
  assert.equal(ui.buttons(ui.render())[0].props['aria-pressed'], true)
  const storeChanged = basket({ store: { ...m2Store, id: 'other-shop' } })
  assert.equal(ui.buttons(ui.setBasket(storeChanged))[0].props['aria-pressed'], false)
  assert.deepEqual(restoreTrustedShoppingProgressV2(
    storeChanged, saved.data.get(shoppingListProgressV2StorageKey)), [])
  const productChanged = basket({ products: m2Products.map((item) =>
    item.id === source.lines[0].productId ? { ...item, id: item.id + '-other' } : item) })
  assert.equal(ui.buttons(ui.setBasket(productChanged))[0].props['aria-pressed'], false)
})

test('real ShoppingListView: invalid physical or monetary pack state cannot display or persist checkmarks', (t) => {
  const saved = storage()
  const source = basket()
  const ui = makeHarness(source, saved)
  t.after(() => ui.dispose())
  ui.buttons(ui.render())[0].props.onClick()
  ui.render()
  const invalid = structuredClone(source)
  const row = invalid.lines.find((line) => line.status === 'matched')
  row.pack.unit = 'l'
  assert.equal(isTrustworthyShoppingBasket(invalid), false)
  const before = saved.data.get(shoppingListProgressV2StorageKey)
  const badButtons = ui.buttons(ui.setBasket(invalid))
  assert.equal(badButtons[0].props['aria-pressed'], false)
  badButtons[0].props.onClick()
  assert.equal(ui.buttons(ui.render())[0].props['aria-pressed'], false)
  assert.equal(saved.data.get(shoppingListProgressV2StorageKey), before)
})

test('real ShoppingListView: legacy migration requires an exact priced basket and absent v2 record', (t) => {
  const original = basket()
  const first = original.lines[0].id
  const legacy = serializeShoppingListProgress(original, [first])
  const old = storage([[shoppingListProgressStorageKey, legacy]])
  const migrated = makeHarness(original, old)
  t.after(() => migrated.dispose())
  assert.equal(migrated.buttons(migrated.render())[0].props['aria-pressed'], true)
  assert.ok(old.data.has(shoppingListProgressV2StorageKey))
  assert.equal(old.data.get(shoppingListProgressStorageKey), legacy)

  const differentProducts = m2Products.map((p) =>
    p.id === original.lines[0].productId ? { ...p, priceCents: p.priceCents + 1 } : p)
  const repriced = basket({ products: differentProducts })
  const stale = storage([[shoppingListProgressStorageKey, legacy]])
  const unmatched = makeHarness(repriced, stale)
  t.after(() => unmatched.dispose())
  assert.equal(unmatched.buttons(unmatched.render())[0].props['aria-pressed'], false)

  const existingV2 = storage([
    [shoppingListProgressStorageKey, legacy],
    [shoppingListProgressV2StorageKey, '{corrupt'],
  ])
  const blocked = makeHarness(original, existingV2)
  t.after(() => blocked.dispose())
  assert.equal(blocked.buttons(blocked.render())[0].props['aria-pressed'], false)
})
