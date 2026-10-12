import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import * as shoppingProgress from '../src/features/shopping-list/shoppingListProgress.ts'

// Independent QA #248: evaluate real ShoppingListView TSX/click callbacks against
// controlled M2 baskets. This is a synchronous hook harness, NOT DOM hydration.
const require = createRequire(import.meta.url)
const compiled = ts.transpileModule(
  readFileSync(new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url), 'utf8'),
  {
    fileName: 'ShoppingListView.tsx',
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  },
)
assert.deepEqual(compiled.diagnostics, [])

function syntheticBasket(store = m2Store, products = m2Products) {
  return buildOneStoreBasket({
    store, products, plan: m2InitialPlan,
    recipes: m2Recipes, activeDays: m2DefaultActiveDays,
  })
}

function memoryStorage({ denyRead = false, denyWrite = false } = {}) {
  const data = new Map()
  const writes = []
  return {
    data, writes,
    getItem(key) {
      if (denyRead) throw Error('synthetic private mode: storage reads denied')
      return data.get(key) ?? null
    },
    setItem(key, value) {
      if (denyWrite) throw Error('synthetic private mode: storage writes denied')
      data.set(key, value)
      writes.push({ key, value })
    },
  }
}

function mountView(storage) {
  const slots = []
  let index = 0
  const hooks = {
    useMemo: calculate => calculate(),
    useEffect: effect => effect(),
    useState: initialize => {
      const position = index++
      if (!(position in slots)) slots[position] =
        typeof initialize === 'function' ? initialize() : initialize
      return [slots[position], update => {
        slots[position] = typeof update === 'function' ? update(slots[position]) : update
      }]
    },
  }
  const dependencies = new Map([
    ['react', hooks],
    ['react/jsx-runtime', require('react/jsx-runtime')],
    ['./shoppingListProgress', shoppingProgress],
  ])
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, key => {
      assert.ok(dependencies.has(key), 'unexpected shopping view dependency: ' + key)
      return dependencies.get(key)
    },
  )
  function walk(node) {
    if (Array.isArray(node)) return node.flatMap(walk)
    if (!node || typeof node !== 'object' || !('props' in node)) return []
    return [node, ...walk(node.props.children)]
  }
  return {
    render(basket) {
      index = 0
      return walk(module.exports.ShoppingListView({ basket }))
    },
  }
}

function riceButton(nodes) {
  const found = nodes.find(node => node.type === 'button' && node.key === 'basmati-rice')
  assert.ok(found, 'expected actual TSX shopping button for controlled rice demand')
  return found
}

function checked(button) {
  return button.props.className.split(' ').includes('checked')
}

function withStorage(run, policy = {}) {
  const storage = memoryStorage(policy)
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true, writable: true, value: { localStorage: storage },
  })
  try { return run(storage) } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete globalThis.window
  }
}

test('QA #248: actual shopping tick cannot survive a store switch and cannot resurrect on return', () => {
  withStorage(storage => {
    const original = syntheticBasket()
    const before = structuredClone(original)
    const newStore = { ...m2Store, id: 'synthetic-independent-store' }
    const switched = syntheticBasket(newStore, m2Products.map(product => ({
      ...product, storeId: newStore.id,
    })))
    assert.equal(switched.lines.find(line => line.id === 'basmati-rice')?.status, 'matched')
    const view = mountView(storage)
    assert.equal(checked(riceButton(view.render(original))), false)
    riceButton(view.render(original)).props.onClick()
    assert.equal(checked(riceButton(view.render(original))), true)

    assert.equal(checked(riceButton(view.render(switched))), false,
      'switching store must immediately hide stale checked state')
    assert.equal(checked(riceButton(view.render(switched))), false)
    assert.deepEqual(JSON.parse(storage.data.get(shoppingProgress.shoppingListProgressStorageKey)).doneLineIds, [])
    assert.equal(checked(riceButton(view.render(original))), false)
    assert.equal(checked(riceButton(view.render(original))), false)
    assert.deepEqual(original, before, 'shopping callback must not mutate original basket')
  })
})

test('QA #248: unresolved-to-matched and matched-to-unresolved physical changes reset real view state', () => {
  withStorage(storage => {
    const unresolved = syntheticBasket(m2Store, m2Products.filter(product => product.id !== 'basmati-1kg'))
    const matched = syntheticBasket()
    assert.equal(unresolved.lines.find(line => line.id === 'basmati-rice')?.status, 'unresolved')
    assert.equal(matched.lines.find(line => line.id === 'basmati-rice')?.status, 'matched')
    const before = structuredClone({ unresolved, matched })
    const view = mountView(storage)

    riceButton(view.render(unresolved)).props.onClick()
    assert.equal(checked(riceButton(view.render(unresolved))), true)
    assert.equal(checked(riceButton(view.render(matched))), false)
    assert.equal(checked(riceButton(view.render(matched))), false)

    riceButton(view.render(matched)).props.onClick()
    assert.equal(checked(riceButton(view.render(matched))), true)
    assert.equal(checked(riceButton(view.render(unresolved))), false)
    assert.equal(checked(riceButton(view.render(unresolved))), false)
    assert.deepEqual(JSON.parse(storage.data.get(shoppingProgress.shoppingListProgressStorageKey)).doneLineIds, [])
    assert.deepEqual({ unresolved, matched }, before)
  })
})

test('QA #248: corrupt saved progress fails closed before a new store transition', () => {
  withStorage(storage => {
    const key = shoppingProgress.shoppingListProgressStorageKey
    storage.data.set(key, '{malformed saved data')
    const view = mountView(storage)
    const current = syntheticBasket()
    assert.equal(checked(riceButton(view.render(current))), false)
    riceButton(view.render(current)).props.onClick()
    assert.equal(checked(riceButton(view.render(current))), true)

    const otherStore = { ...m2Store, id: 'qa-corrupt-storage-other-store' }
    const switched = syntheticBasket(otherStore, m2Products.map(product => ({
      ...product, storeId: otherStore.id,
    })))
    assert.equal(checked(riceButton(view.render(switched))), false)
    assert.equal(checked(riceButton(view.render(switched))), false)
    assert.deepEqual(JSON.parse(storage.data.get(key)).doneLineIds, [])
  })
})

test('QA #248: denied private-mode storage keeps session usable without leaking a tick across stores', () => {
  withStorage(storage => {
    const view = mountView(storage)
    const current = syntheticBasket()
    const otherStore = { ...m2Store, id: 'qa-privacy-other-store' }
    const switched = syntheticBasket(otherStore, m2Products.map(product => ({
      ...product, storeId: otherStore.id,
    })))

    assert.equal(checked(riceButton(view.render(current))), false)
    riceButton(view.render(current)).props.onClick()
    assert.equal(checked(riceButton(view.render(current))), true,
      'local session remains usable when storage denies writes')
    assert.equal(checked(riceButton(view.render(switched))), false)
    assert.equal(checked(riceButton(view.render(switched))), false)
    assert.equal(checked(riceButton(view.render(current))), false)
    assert.equal(checked(riceButton(view.render(current))), false)
    assert.deepEqual(storage.writes, [],
      'denied storage must not claim successful persistence')
  }, { denyRead: true, denyWrite: true })
})
