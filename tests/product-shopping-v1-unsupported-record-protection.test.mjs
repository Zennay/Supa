import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2Store, m2Recipes, m2Products, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { quantityUnitLabelNl } from '../src/lib/quantityPresentation.ts'
import * as progress from '../src/features/shopping-list/shoppingListProgress.ts'

// Expected-RED product issue #1887: run actual compiled v1 effect, not a
// reimplementation. Disposable M2 fixture and memory store; no real customers.
const nativeRequire = createRequire(import.meta.url)
const compiled = ts.transpileModule(
  readFileSync(new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url), 'utf8'),
  { fileName: 'ShoppingListView.tsx', compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  }, reportDiagnostics: true },
)
assert.deepEqual(compiled.diagnostics, [])
const basket = days => buildOneStoreBasket({
  store: m2Store, plan: m2InitialPlan, recipes: m2Recipes, products: m2Products,
  activeDays: days,
})
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  return [node, ...descendants(node.props.children)]
}
function mount(initialRaw) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let raw = initialRaw
  const writes = []
  const state = []
  let cursor = 0
  let effects = []
  const fakeStorage = {
    getItem(key) {
      assert.equal(key, progress.shoppingListProgressStorageKey)
      return raw
    },
    setItem(key, value) {
      assert.equal(key, progress.shoppingListProgressStorageKey)
      raw = value
      writes.push(value)
    },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true, value: { localStorage: fakeStorage },
  })
  const requireModule = name => {
    if (name === 'react') return {
      useMemo: fn => fn(),
      useEffect: fn => effects.push(fn),
      useState(initial) {
        const index = cursor++
        if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
        return [state[index], update => {
          state[index] = typeof update === 'function' ? update(state[index]) : update
        }]
      },
    }
    if (name === 'react/jsx-runtime') return nativeRequire(name)
    if (name === '../../lib/quantityPresentation') return { quantityUnitLabelNl }
    if (name === './shoppingListProgress') return progress
    throw Error('Unexpected ShoppingListView import: ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, requireModule,
  )
  return {
    render(currentBasket) {
      cursor = 0
      effects = []
      const output = module.exports.ShoppingListView({ basket: currentBasket })
      const scheduled = [...effects]
      return {
        rows: descendants(output).filter(node =>
          node.type === 'button' && node.props.className?.split(' ').includes('shopping-row')),
        flush() { for (const effect of scheduled) effect() },
      }
    },
    get raw() { return raw },
    set raw(value) { raw = value },
    writes,
    close() {
      if (prior) Object.defineProperty(globalThis, 'window', prior)
      else delete globalThis.window
    },
  }
}
const cases = [
  ['future schema', JSON.stringify({ schemaVersion: 3, basketKey: 'future', doneLineIds: ['x'] })],
  ['malformed JSON', '{"schemaVersion":1,"doneLineIds":'],
  ['unsupported shape', JSON.stringify([1, 2, 3])],
  ['malformed v1 IDs', JSON.stringify({ schemaVersion: 1, basketKey: 'old', doneLineIds: 'bad' })],
]
for (const [name, stored] of cases) {
  test('product #1887: preserve ' + name + ' on mount, ticks, and new demand', () => {
    const first = basket(['Di'])
    const other = basket(['Wo'])
    const priorBasket = structuredClone(first)
    const session = mount(stored)
    try {
      const firstFrame = session.render(first)
      assert.ok(firstFrame.rows.length)
      firstFrame.flush()
      assert.equal(session.raw, stored, 'must not overwrite unknown bytes on initial effect')
      firstFrame.rows[0].props.onClick()
      const later = session.render(first)
      later.flush()
      assert.equal(session.raw, stored, 'user tick must not downgrade unknown bytes')
      const changing = session.render(other)
      changing.flush()
      session.render(other).flush()
      assert.equal(session.raw, stored, 'changing demand must not downgrade unknown bytes')
      assert.deepEqual(session.writes, [])
      assert.deepEqual(first, priorBasket)
    } finally {
      session.close()
    }
  })
}

test('product #1887: empty v1 key can save checked progress and recover after restart', () => {
  const current = basket(['Di'])
  const session = mount(null)
  try {
    const first = session.render(current)
    first.flush()
    assert.equal(JSON.parse(session.raw).schemaVersion, 1)
    first.rows[0].props.onClick()
    session.render(current).flush()
    assert.deepEqual(JSON.parse(session.raw).doneLineIds, [current.lines[0].id])
  } finally {
    session.close()
  }
})

test('product #1887: valid v1 record, including duplicates and retired IDs, remains writable', () => {
  const current = basket(['Di'])
  const id = current.lines[0].id
  const stored = JSON.stringify({
    schemaVersion: 1,
    basketKey: progress.shoppingListBasketKey(current),
    doneLineIds: [id, id, 'retired'],
  })
  const session = mount(stored)
  try {
    const first = session.render(current)
    assert.ok(first.rows[0].props.className.includes('checked'))
    first.flush()
    assert.deepEqual(JSON.parse(session.raw).doneLineIds, [id])
    assert.ok(session.writes.length)
  } finally { session.close() }
})
