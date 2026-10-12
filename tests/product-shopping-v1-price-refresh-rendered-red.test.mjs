import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import * as progressStorage from '../src/features/shopping-list/shoppingListProgress.ts'

// Product #1056: execute real compiled main ShoppingListView hook/effect/click
// behavior, not a hand-copied model. Controlled synthetic M2 and in-memory
// localStorage only; this is deliberately RED until owner-led v2 integration.
const require = createRequire(import.meta.url)
const source = readFileSync(
  new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  fileName: 'ShoppingListView.tsx',
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])

const basketFor = (products = m2Products, store = m2Store) =>
  buildOneStoreBasket({
    store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products,
  })
const childrenOf = (element) => {
  if (Array.isArray(element)) return element.flatMap(childrenOf)
  if (!element || typeof element !== 'object' || !('props' in element)) return []
  return [element, ...childrenOf(element.props.children)]
}

function startView(basket) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let active = basket
  let durable = null
  const state = []
  let cursor = 0
  let effects = []
  const writes = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: {
      getItem(key) {
        assert.equal(key, progressStorage.shoppingListProgressStorageKey)
        return durable
      },
      setItem(key, value) {
        assert.equal(key, progressStorage.shoppingListProgressStorageKey)
        durable = value
        writes.push(value)
      },
    } },
  })
  const hooks = {
    useMemo: (cb) => cb(),
    useEffect: (cb) => effects.push(cb),
    useState(initial) {
      const i = cursor++
      if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial
      return [state[i], (next) => {
        state[i] = typeof next === 'function' ? next(state[i]) : next
      }]
    },
  }
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    mod, mod.exports,
    (name) => {
      if (name === 'react') return hooks
      if (name === './shoppingListProgress') return progressStorage
      return require(name)
    },
  )
  return {
    updateBasket(value) { active = value },
    render() {
      cursor = 0
      effects = []
      const tree = childrenOf(mod.exports.ShoppingListView({ basket: active }))
      const pending = [...effects]
      return {
        rows: tree.filter((e) =>
          e.type === 'button' && e.props.className?.includes('shopping-row')),
        flush() { for (const effect of pending) effect() },
      }
    },
    get raw() { return durable },
    get writes() { return writes },
    close() {
      if (prior) Object.defineProperty(globalThis, 'window', prior)
      else delete globalThis.window
    },
  }
}

test('product #1056 RED: a checked Tuesday rice item survives a one-cent basket refresh in the mounted view', () => {
  const initial = basketFor()
  const lineIndex = initial.lines.findIndex((line) => line.id === 'basmati-rice')
  assert.ok(lineIndex >= 0)
  const s = startView(initial)
  try {
    s.render().flush()
    const before = s.render()
    before.rows[lineIndex].props.onClick()
    s.render().flush()
    assert.match(s.render().rows[lineIndex].props.className, /checked/)
    const oldProgress = s.raw
    assert.deepEqual(JSON.parse(oldProgress).doneLineIds, ['basmati-rice'])
    const updatedProducts = m2Products.map((p) => p.id === 'basmati-1kg'
      ? { ...p, priceCents: p.priceCents + 1 } : p)
    const refreshed = basketFor(updatedProducts)
    assert.notEqual(refreshed.totalCents, initial.totalCents)
    assert.deepEqual(
      refreshed.lines.map((l) => l.id),
      initial.lines.map((l) => l.id),
    )
    s.updateBasket(refreshed)
    const firstRefreshPaint = s.render()
    assert.match(
      firstRefreshPaint.rows[lineIndex].props.className,
      /checked/,
      'pure money refresh must not clear checked shopping tasks on first paint',
    )
    firstRefreshPaint.flush()
    s.render().flush()
    assert.match(s.render().rows[lineIndex].props.className, /checked/)
    assert.deepEqual(JSON.parse(s.raw).doneLineIds, ['basmati-rice'])
  } finally { s.close() }
})

test('product #1056 control: switching physical store never retains checked rice', () => {
  const initial = basketFor()
  const lineIndex = initial.lines.findIndex((line) => line.id === 'basmati-rice')
  assert.ok(lineIndex >= 0)
  const s = startView(initial)
  try {
    s.render().flush()
    s.render().rows[lineIndex].props.onClick()
    s.render().flush()
    assert.match(s.render().rows[lineIndex].props.className, /checked/)
    const newStore = { id: 'alternate-demo-store', name: 'Alternatief demo' }
    const newBasket = basketFor(
      m2Products.map((p) => ({ ...p, storeId: newStore.id })),
      newStore,
    )
    s.updateBasket(newBasket)
    const switched = s.render()
    assert.doesNotMatch(switched.rows[lineIndex].props.className, /checked/)
    switched.flush()
    s.render().flush()
    assert.doesNotMatch(s.render().rows[lineIndex].props.className, /checked/)
  } finally { s.close() }
})
