import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2Store, m2Recipes, m2Products, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { quantityUnitLabelNl } from '../src/lib/quantityPresentation.ts'
import * as saved from '../src/features/shopping-list/shoppingListProgress.ts'

// Independent quality acceptance of the actual compiled v1 component.
// Synthetic M2 data and disposable in-memory localStorage only; no hydrated browser.
const nativeRequire = createRequire(import.meta.url)
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

function makeBasket(days) {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    products: m2Products, activeDays: days,
  })
}

function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  return [node, ...descendants(node.props.children)]
}

function checked(row) {
  return row.props.className.split(' ').includes('checked')
}

function makeHarness(initialRaw = null, failWrites = false) {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let record = initialRaw
  let hookIndex = 0
  let effects = []
  const state = []
  const writes = []
  const localStorage = {
    getItem(key) {
      assert.equal(key, saved.shoppingListProgressStorageKey)
      return record
    },
    setItem(key, value) {
      assert.equal(key, saved.shoppingListProgressStorageKey)
      if (failWrites) throw new Error('synthetic private-mode denial')
      record = value
      writes.push(value)
    },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true, value: { localStorage },
  })
  const imports = (name) => {
    if (name === 'react') return {
      useMemo: fn => fn(),
      useEffect: fn => effects.push(fn),
      useState(initial) {
        const slot = hookIndex++
        if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial
        return [state[slot], update => {
          state[slot] = typeof update === 'function' ? update(state[slot]) : update
        }]
      },
    }
    if (name === 'react/jsx-runtime') return nativeRequire(name)
    if (name === '../../lib/quantityPresentation') return { quantityUnitLabelNl }
    if (name === './shoppingListProgress') return saved
    throw new Error('Unexpected v1 dependency: ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, imports,
  )
  return {
    render(basket) {
      hookIndex = 0
      effects = []
      const tree = module.exports.ShoppingListView({ basket })
      const scheduled = [...effects]
      return {
        rows: descendants(tree).filter(node =>
          node.type === 'button' &&
          node.props.className?.split(' ').includes('shopping-row')),
        flush() { for (const effect of scheduled) effect() },
      }
    },
    get raw() { return record },
    writes,
    close() {
      if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow)
      else delete globalThis.window
    },
  }
}

test('QA v1: rapid mixed clicks persist only final parity and survive a fresh mount', () => {
  const basket = makeBasket(['Di'])
  const original = structuredClone(basket)
  const session = makeHarness()
  let persisted
  try {
    const firstFrame = session.render(basket)
    assert.ok(firstFrame.rows.length >= 2)
    firstFrame.flush()
    const [a, b] = firstFrame.rows
    a.props.onClick()
    b.props.onClick()
    a.props.onClick()
    const settled = session.render(basket)
    assert.equal(checked(settled.rows[0]), false)
    assert.equal(checked(settled.rows[1]), true)
    settled.flush()
    assert.deepEqual(JSON.parse(session.raw).doneLineIds, [basket.lines[1].id])

    // Another burst from the same painted frame must use each updater's current state.
    settled.rows[0].props.onClick()
    settled.rows[0].props.onClick()
    settled.rows[0].props.onClick()
    settled.rows[1].props.onClick()
    const final = session.render(basket)
    assert.equal(checked(final.rows[0]), true)
    assert.equal(checked(final.rows[1]), false)
    final.flush()
    persisted = session.raw
    assert.deepEqual(JSON.parse(persisted).doneLineIds, [basket.lines[0].id])
    assert.deepEqual(basket, original, 'neither clicks nor effect mutate M2 input')
  } finally {
    session.close()
  }

  const restart = makeHarness(persisted)
  try {
    const restored = restart.render(basket)
    assert.equal(checked(restored.rows[0]), true)
    assert.equal(checked(restored.rows[1]), false)
    restored.flush()
    assert.deepEqual(JSON.parse(restart.raw).doneLineIds, [basket.lines[0].id])
  } finally {
    restart.close()
  }
})

test('QA v1: switching to different demand does not persist prior basket checkmarks', () => {
  const tuesday = makeBasket(['Di'])
  const wednesday = makeBasket(['Wo'])
  assert.notEqual(saved.shoppingListBasketKey(tuesday), saved.shoppingListBasketKey(wednesday))
  const beforeA = structuredClone(tuesday)
  const beforeB = structuredClone(wednesday)
  const session = makeHarness()
  try {
    const initial = session.render(tuesday)
    initial.flush()
    initial.rows[0].props.onClick()
    session.render(tuesday).flush()
    assert.deepEqual(JSON.parse(session.raw).doneLineIds, [tuesday.lines[0].id])

    // First changed-basket render schedules React's basket-key sync effect.
    const changing = session.render(wednesday)
    assert.ok(changing.rows.length > 0)
    assert.ok(changing.rows.every(row => !checked(row)))
    changing.flush()
    const settled = session.render(wednesday)
    assert.ok(settled.rows.every(row => !checked(row)))
    settled.flush()
    assert.equal(JSON.parse(session.raw).basketKey, saved.shoppingListBasketKey(wednesday))
    assert.deepEqual(JSON.parse(session.raw).doneLineIds, [])
    assert.deepEqual(tuesday, beforeA)
    assert.deepEqual(wednesday, beforeB)
  } finally {
    session.close()
  }
})

test('QA v1: denied storage never prevents rapid toggles from updating visible session state', () => {
  const basket = makeBasket(['Di'])
  const untouched = 'UNTRUSTED_EXISTING_V1_BYTES'
  const session = makeHarness(untouched, true)
  try {
    const initial = session.render(basket)
    assert.doesNotThrow(() => initial.flush())
    initial.rows[0].props.onClick()
    initial.rows[0].props.onClick()
    initial.rows[0].props.onClick()
    const after = session.render(basket)
    assert.equal(checked(after.rows[0]), true)
    assert.doesNotThrow(() => after.flush())
    assert.equal(session.raw, untouched)
    assert.deepEqual(session.writes, [])
  } finally {
    session.close()
  }
})
