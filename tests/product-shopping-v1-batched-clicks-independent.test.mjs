import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2Store, m2Recipes, m2Products, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { quantityUnitLabelNl } from '../src/lib/quantityPresentation.ts'
import * as progressStorage from '../src/features/shopping-list/shoppingListProgress.ts'

// Product-core #1891: exercise actual compiled ShoppingListView events/effects,
// including multiple clicks delivered before a React re-render. Synthetic M2
// fixtures and a disposable localStorage double; not live browser/M3 evidence.
const nodeRequire = createRequire(import.meta.url)
const compiled = ts.transpileModule(
  readFileSync(new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url), 'utf8'),
  { fileName: 'ShoppingListView.tsx', compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  }, reportDiagnostics: true },
)
assert.deepEqual(compiled.diagnostics, [])

const basket = buildOneStoreBasket({
  store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
  activeDays: ['Di'], products: m2Products,
})
const key = progressStorage.shoppingListProgressStorageKey
const initial = progressStorage.serializeShoppingListProgress(basket, [])
function elements(item) {
  if (Array.isArray(item)) return item.flatMap(elements)
  if (!item || typeof item !== 'object' || !('props' in item)) return []
  return [item, ...elements(item.props.children)]
}
function session({ denyWrite = false } = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let saved = initial
  let writeDenied = denyWrite
  const writes = []
  const slots = []
  let cursor = 0
  let pending = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true, value: { localStorage: {
      getItem(name) {
        assert.equal(name, key)
        return saved
      },
      setItem(name, value) {
        assert.equal(name, key)
        if (writeDenied) throw Error('synthetic write denial')
        saved = value
        writes.push(value)
      },
    } },
  })
  const imports = id => {
    if (id === 'react') return {
      useMemo: fn => fn(),
      useEffect: fn => pending.push(fn),
      useState(value) {
        const index = cursor++
        if (!(index in slots)) {
          slots[index] = { value: typeof value === 'function' ? value() : value }
        }
        return [slots[index].value, next => {
          slots[index].value = typeof next === 'function'
            ? next(slots[index].value) : next
        }]
      },
    }
    if (id === 'react/jsx-runtime') return nodeRequire(id)
    if (id === '../../lib/quantityPresentation') return { quantityUnitLabelNl }
    if (id === './shoppingListProgress') return progressStorage
    throw Error('unexpected ShoppingListView import: ' + id)
  }
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    mod, mod.exports, imports,
  )
  return {
    render() {
      cursor = 0
      pending = []
      const all = elements(mod.exports.ShoppingListView({ basket }))
      const effects = [...pending]
      return {
        rows: all.filter(n => n.type === 'button' && n.props.className?.includes('shopping-row')),
        alerts: all.filter(n => n.props.role === 'alert'),
        flush() { for (const callback of effects) callback() },
      }
    },
    get raw() { return saved },
    get writes() { return writes },
    set denyWrite(value) { writeDenied = value },
    close() {
      if (previous) Object.defineProperty(globalThis, 'window', previous)
      else delete globalThis.window
    },
  }
}

test('product #1891: two pre-render taps on one row cancel without a misleading saved check', () => {
  const s = session()
  try {
    s.render().flush()
    const staleButton = s.render().rows[0]
    staleButton.props.onClick()
    staleButton.props.onClick()
    s.render().flush()
    assert.doesNotMatch(s.render().rows[0].props.className, /checked/)
    assert.deepEqual(JSON.parse(s.raw).doneLineIds, [])
    assert.equal(s.writes.length, 0, 'unchanged v1 bytes need no redundant write')
    assert.equal(s.render().alerts.length, 0)
  } finally { s.close() }
})

test('product #1891: different pre-render taps retain both checkmarks in one durable snapshot', () => {
  const s = session()
  try {
    s.render().flush()
    const stale = s.render().rows
    assert.ok(stale.length >= 2, 'synthetic plan needs two product rows')
    stale[0].props.onClick()
    stale[1].props.onClick()
    s.render().flush()
    assert.deepEqual(JSON.parse(s.raw).doneLineIds, [basket.lines[0].id, basket.lines[1].id])
    assert.equal(s.writes.length, 1)
    assert.match(s.render().rows[0].props.className, /checked/)
    assert.match(s.render().rows[1].props.className, /checked/)
    assert.equal(s.render().alerts.length, 0)
  } finally { s.close() }
})

test('product #1891: failed batched save waits for another explicit edit after storage recovers', () => {
  const s = session({ denyWrite: true })
  try {
    s.render().flush()
    const stale = s.render().rows
    stale[0].props.onClick()
    stale[1].props.onClick()
    s.render().flush()
    assert.equal(s.raw, initial)
    assert.match(String(s.render().alerts[0]?.props.children), /tijdelijk en niet opgeslagen/)
    s.denyWrite = false
    s.render().flush()
    s.render().flush()
    assert.equal(s.raw, initial, 'passive recovery must not save spent intent')
    assert.equal(s.writes.length, 0)
    assert.match(String(s.render().alerts[0]?.props.children), /opslag niet beschikbaar/)
    s.render().rows[1].props.onClick()
    s.render().flush()
    assert.deepEqual(JSON.parse(s.raw).doneLineIds, [basket.lines[0].id])
    assert.equal(s.writes.length, 1)
    assert.equal(s.render().alerts.length, 0)
  } finally { s.close() }
})
