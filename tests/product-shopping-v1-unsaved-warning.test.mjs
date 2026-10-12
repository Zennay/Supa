import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2Store, m2Recipes, m2Products, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { quantityUnitLabelNl } from '../src/lib/quantityPresentation.ts'
import * as persisted from '../src/features/shopping-list/shoppingListProgress.ts'

// Real TypeScript-compiled shopping-v1 React event/effect lifecycle; controlled
// M2 fixtures and disposable storage. Not actual browser hydration or retailers.
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
  store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
  activeDays: days, products: m2Products,
})
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  return [node, ...nodes(node.props.children)]
}
function app(initialRaw, options = {}) {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let stored = initialRaw
  let failRead = Boolean(options.failRead)
  let failWrite = Boolean(options.failWrite)
  const writes = []
  const slots = []
  let effects = []
  let cursor = 0
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: {
      getItem(key) {
        assert.equal(key, persisted.shoppingListProgressStorageKey)
        if (failRead) throw Error('synthetic read denied')
        return stored
      },
      setItem(key, value) {
        assert.equal(key, persisted.shoppingListProgressStorageKey)
        if (failWrite) throw Error('synthetic write denied')
        stored = value
        writes.push(value)
      },
    } },
  })
  const imports = name => {
    if (name === 'react') return {
      useMemo: fn => fn(),
      useEffect: fn => effects.push(fn),
      useState(initial) {
        const n = cursor++
        if (!(n in slots)) slots[n] = typeof initial === 'function' ? initial() : initial
        return [slots[n], next => {
          slots[n] = typeof next === 'function' ? next(slots[n]) : next
        }]
      },
    }
    if (name === 'react/jsx-runtime') return nativeRequire(name)
    if (name === '../../lib/quantityPresentation') return { quantityUnitLabelNl }
    if (name === './shoppingListProgress') return persisted
    throw Error('unexpected import ' + name)
  }
  const loaded = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    loaded, loaded.exports, imports,
  )
  return {
    render(current) {
      cursor = 0
      effects = []
      const tree = loaded.exports.ShoppingListView({ basket: current })
      const queued = [...effects]
      const items = nodes(tree)
      return {
        rows: items.filter(x => x.type === 'button' && x.props.className?.includes('shopping-row')),
        warnings: items.filter(x => x.props.role === 'alert'),
        flush() { for (const effect of queued) effect() },
      }
    },
    get raw() { return stored },
    set raw(v) { stored = v },
    set denyRead(v) { failRead = v },
    set denyWrite(v) { failWrite = v },
    writes,
    close() {
      if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
      else delete globalThis.window
    },
  }
}
test('product #1891: future schema preservation explains temporarily unsaved checkmarks', () => {
  const week = basket(['Di'])
  const protectedBytes = JSON.stringify({ schemaVersion: 8, value: 'future' })
  const session = app(protectedBytes)
  try {
    assert.equal(session.render(week).warnings.length, 0)
    session.render(week).flush()
    const warning = session.render(week).warnings
    assert.equal(warning.length, 1)
    assert.match(String(warning[0].props.children), /tijdelijk/i)
    assert.match(String(warning[0].props.children), /niet opgeslagen/i)
    session.render(week).rows[0].props.onClick()
    session.render(week).flush()
    assert.equal(session.raw, protectedBytes)
    assert.deepEqual(session.writes, [])
    assert.equal(session.render(week).warnings.length, 1)
  } finally { session.close() }
})
test('product #1891: protected warning clears after externally removed record and successful new tick', () => {
  const week = basket(['Di'])
  const session = app('malformed { json')
  try {
    session.render(week).flush()
    assert.equal(session.render(week).warnings.length, 1)
    session.raw = null
    session.render(week).rows[0].props.onClick()
    session.render(week).flush()
    assert.equal(JSON.parse(session.raw).schemaVersion, 1)
    assert.equal(session.render(week).warnings.length, 0)
  } finally { session.close() }
})
for (const kind of ['read', 'write']) {
  test('product #1891: localStorage ' + kind + ' denial announces temporary progress without breaking toggles', () => {
    const week = basket(['Di'])
    const session = app(null, { failRead: kind === 'read', failWrite: kind === 'write' })
    try {
      assert.doesNotThrow(() => session.render(week).flush())
      const warning = session.render(week).warnings
      assert.equal(warning.length, 1)
      assert.match(String(warning[0].props.children), /tijdelijk/i)
      session.render(week).rows[0].props.onClick()
      assert.match(session.render(week).rows[0].props.className, /\bchecked\b/)
      assert.doesNotThrow(() => session.render(week).flush())
      assert.equal(session.render(week).warnings.length, 1)
    } finally { session.close() }
  })
}
test('product #1891: supported v1 storage and genuinely empty week show no unsaved warning', () => {
  const empty = basket([])
  const session = app(null)
  try {
    session.render(empty).flush()
    assert.equal(session.render(empty).warnings.length, 0)
    assert.equal(JSON.parse(session.raw).schemaVersion, 1)
    assert.deepEqual(session.writes.length, 1)
  } finally { session.close() }
})
