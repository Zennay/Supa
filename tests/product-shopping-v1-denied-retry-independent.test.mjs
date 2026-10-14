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

test('product #1891 independently: a denied checkbox write cannot self-heal on props rerender', () => {
  const current = basket(['Wo'])
  const baseline = accepted(storage.shoppingListBasketKey(current), [])
  const s = session(baseline, { write: true })
  try {
    s.render(current).flush()
    s.render(current).buttons[0].props.onClick()
    s.render(current).flush()
    assertAlert(s, current, /opslag niet beschikbaar/)
    s.writeDenied = false
    const sameDemand = basket(['Wo'])
    s.render(sameDemand).flush()
    s.render(sameDemand).flush()
    assert.equal(s.raw, baseline)
    assert.equal(s.writes.length, 0)
    assertAlert(s, sameDemand, /opslag niet beschikbaar/)
    s.render(sameDemand).buttons[1].props.onClick()
    s.render(sameDemand).flush()
    assert.equal(s.writes.length, 1)
    assert.equal(s.render(sameDemand).alerts.length, 0)
    assert.deepEqual(JSON.parse(s.raw).doneLineIds, [
      sameDemand.lines[0].id,
      sameDemand.lines[1].id,
    ])
  } finally { s.close() }
})

test('product #1891 independently: a protected saved key needs a new edit after removal', () => {
  const current = basket(['Di'])
  const prior = accepted(storage.shoppingListBasketKey(current), [current.lines[0].id])
  const s = session(prior, { read: true })
  try {
    s.render(current).flush()
    s.render(current).buttons[1].props.onClick()
    s.readDenied = false
    s.render(current).flush()
    assertAlert(s, current, /eerdere opgeslagen gegevens/)
    assert.equal(s.raw, prior)
    s.raw = null
    s.render(basket(['Di'])).flush()
    assert.equal(s.raw, null)
    assert.equal(s.writes.length, 0)
    assertAlert(s, current, /eerdere opgeslagen gegevens/)
    s.render(current).buttons[2].props.onClick()
    s.render(current).flush()
    assert.equal(s.writes.length, 1)
    assert.equal(s.render(current).alerts.length, 0)
  } finally { s.close() }
})

test('product #1891 independently: regular v1 toggle and same-basket rerender stay quiet', () => {
  const current = basket(['Di'])
  const s = session(accepted(storage.shoppingListBasketKey(current), []))
  try {
    s.render(current).flush()
    assert.equal(s.render(current).alerts.length, 0)
    s.render(current).buttons[0].props.onClick()
    s.render(current).flush()
    s.render(basket(['Di'])).flush()
    assert.deepEqual(JSON.parse(s.raw).doneLineIds, [current.lines[0].id])
    assert.equal(s.render(current).alerts.length, 0)
  } finally { s.close() }
})
