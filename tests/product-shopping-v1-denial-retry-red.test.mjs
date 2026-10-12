import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2Store, m2Recipes, m2Products, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { quantityUnitLabelNl } from '../src/lib/quantityPresentation.ts'
import * as storage from '../src/features/shopping-list/shoppingListProgress.ts'

// Independent review-only acceptance of the actual TypeScript-compiled v1
// component. Deliberately use disposable M2 data; not browser/mobile or M3 proof.
const requireNative = createRequire(import.meta.url)
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
const items = node => {
  if (Array.isArray(node)) return node.flatMap(items)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  return [node, ...items(node.props.children)]
}
const accepted = (basketKey, ids) => JSON.stringify({
  schemaVersion: 1, basketKey, doneLineIds: ids,
})
function session(initialRaw, denial = {}) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let raw = initialRaw
  let readDenied = Boolean(denial.read)
  let writeDenied = Boolean(denial.write)
  const writes = []
  const slots = []
  let effects = []
  let cursor = 0
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: {
      getItem(key) {
        assert.equal(key, storage.shoppingListProgressStorageKey)
        if (readDenied) throw Error('read denied in test')
        return raw
      },
      setItem(key, value) {
        assert.equal(key, storage.shoppingListProgressStorageKey)
        if (writeDenied) throw Error('write denied in test')
        raw = value
        writes.push(value)
      },
    } },
  })
  const imports = id => {
    if (id === 'react') return {
      useMemo: fn => fn(),
      useEffect: fn => effects.push(fn),
      useState(initial) {
        const index = cursor++
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
        return [slots[index], next => {
          slots[index] = typeof next === 'function' ? next(slots[index]) : next
        }]
      },
    }
    if (id === 'react/jsx-runtime') return requireNative(id)
    if (id === '../../lib/quantityPresentation') return { quantityUnitLabelNl }
    if (id === './shoppingListProgress') return storage
    throw Error('unexpected component dependency: ' + id)
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
      const all = items(tree)
      return {
        buttons: all.filter(node => node.type === 'button' && node.props.className?.includes('shopping-row')),
        alerts: all.filter(node => node.props.role === 'alert'),
        flush() { for (const effect of queued) effect() },
      }
    },
    get raw() { return raw },
    set raw(value) { raw = value },
    set readDenied(value) { readDenied = value },
    set writeDenied(value) { writeDenied = value },
    writes,
    close() {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else delete globalThis.window
    },
  }
}
function assertAlert(s, b, phrase) {
  const alerts = s.render(b).alerts
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].props.role, 'alert')
  assert.match(String(alerts[0].props.children), /tijdelijk en niet opgeslagen/)
  assert.match(String(alerts[0].props.children), phrase)
}

test('product #1891 RED: write-denial recovery requires a new explicit checkbox edit', () => {
  const first = basket(['Di'])
  const saved = accepted(storage.shoppingListBasketKey(first), [])
  const s = session(saved, { write: true })
  try {
    s.render(first).flush()
    s.render(first).buttons[0].props.onClick()
    s.render(first).flush()
    assertAlert(s, first, /opslag niet beschikbaar/)
    assert.equal(s.writes.length, 0)
    s.writeDenied = false
    const sameDemandNewRef = basket(['Di'])
    s.render(sameDemandNewRef).flush()
    assert.equal(s.raw, saved, 'unrelated rerender cannot retry the stale failed write')
    assert.equal(s.writes.length, 0)
    assertAlert(s, sameDemandNewRef, /opslag niet beschikbaar/)
    s.render(sameDemandNewRef).buttons[1].props.onClick()
    s.render(sameDemandNewRef).flush()
    assert.equal(s.writes.length, 1)
    assert.equal(s.render(sameDemandNewRef).alerts.length, 0)
  } finally { s.close() }
})

test('product #1891 RED: protected read-denial edit cannot auto-save after external key deletion', () => {
  const first = basket(['Di'])
  const saved = accepted(storage.shoppingListBasketKey(first), [first.lines[0].id])
  const s = session(saved, { read: true })
  try {
    s.render(first).flush()
    s.render(first).buttons[1].props.onClick()
    s.readDenied = false
    s.render(first).flush()
    assert.equal(s.writes.length, 0)
    assertAlert(s, first, /eerdere opgeslagen gegevens/)
    s.raw = null // External deletion alone is not a fresh user edit.
    s.render(basket(['Di'])).flush()
    assert.equal(s.raw, null, 'do not retry a prior blocked intent without another click')
    assert.equal(s.writes.length, 0)
    assert.ok(s.render(first).alerts.length > 0)
    s.render(first).buttons[2].props.onClick()
    s.render(first).flush()
    assert.equal(s.writes.length, 1)
    assert.equal(s.render(first).alerts.length, 0)
  } finally { s.close() }
})

test('product #1891 control: a valid initial read and new checkbox edit still save', () => {
  const b = basket(['Di'])
  const s = session(accepted(storage.shoppingListBasketKey(b), []))
  try {
    s.render(b).flush()
    s.render(b).buttons[0].props.onClick()
    s.render(b).flush()
    assert.deepEqual(JSON.parse(s.raw).doneLineIds, [b.lines[0].id])
    assert.equal(s.render(b).alerts.length, 0)
  } finally { s.close() }
})
