import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2Store, m2Recipes, m2Products, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { quantityUnitLabelNl } from '../src/lib/quantityPresentation.ts'
import * as progressStorage from '../src/features/shopping-list/shoppingListProgress.ts'

// Review-only product acceptance: real compiled TSX effects/events, synthetic M2
// baskets and localStorage. This is neither a browser run nor retailer evidence.
const nativeRequire = createRequire(import.meta.url)
const output = ts.transpileModule(
  readFileSync(new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url), 'utf8'),
  { fileName: 'ShoppingListView.tsx', compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  }, reportDiagnostics: true },
)
assert.deepEqual(output.diagnostics, [])
const week = days => buildOneStoreBasket({
  store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
  activeDays: days, products: m2Products,
})
function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  return [node, ...descendants(node.props.children)]
}
function mount(initialRaw, { denyGetter = false } = {}) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let raw = initialRaw
  let getterDenied = denyGetter
  const writes = []
  const slots = []
  let cursor = 0
  let effects = []
  const localStorage = {
    getItem(key) {
      assert.equal(key, progressStorage.shoppingListProgressStorageKey)
      return raw
    },
    setItem(key, value) {
      assert.equal(key, progressStorage.shoppingListProgressStorageKey)
      raw = value
      writes.push(value)
    },
  }
  const windowStub = {}
  Object.defineProperty(windowStub, 'localStorage', {
    get() {
      if (getterDenied) throw Error('synthetic localStorage getter denied')
      return localStorage
    },
  })
  Object.defineProperty(globalThis, 'window', { value: windowStub, configurable: true })
  const imported = name => {
    if (name === 'react') return {
      useMemo: fn => fn(),
      useEffect: fn => effects.push(fn),
      useState(value) {
        const index = cursor++
        if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value
        return [slots[index], next => {
          slots[index] = typeof next === 'function' ? next(slots[index]) : next
        }]
      },
    }
    if (name === 'react/jsx-runtime') return nativeRequire(name)
    if (name === '../../lib/quantityPresentation') return { quantityUnitLabelNl }
    if (name === './shoppingListProgress') return progressStorage
    throw Error('unexpected import: ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', output.outputText)(
    module, module.exports, imported,
  )
  return {
    render(basket) {
      cursor = 0
      effects = []
      const nodes = descendants(module.exports.ShoppingListView({ basket }))
      const pendingEffects = [...effects]
      return {
        rows: nodes.filter(n => n.type === 'button' && n.props.className?.includes('shopping-row')),
        alerts: nodes.filter(n => n.props.role === 'alert'),
        flush() { for (const effect of pendingEffects) effect() },
      }
    },
    get raw() { return raw },
    set raw(value) { raw = value },
    set denyGetter(value) { getterDenied = value },
    writes,
    close() {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else delete globalThis.window
    },
  }
}

test('product #1891: present but empty storage bytes must not be mistaken for a missing key', () => {
  const basket = week(['Di'])
  const s = mount('')
  try {
    s.render(basket).flush()
    assert.equal(s.raw, '')
    assert.equal(s.writes.length, 0)
    assert.match(String(s.render(basket).alerts[0]?.props.children), /eerdere opgeslagen gegevens/)
    const initial = s.render(basket).rows[0]
    initial.props.onClick()
    assert.match(s.render(basket).rows[0].props.className, /checked/)
    s.render(basket).flush()
    assert.equal(s.raw, '')
    assert.equal(s.writes.length, 0)

    // Only a later explicit checkmark change following external removal may
    // persist a new v1 record; no automatic downgrade of the empty bytes.
    s.raw = null
    s.render(basket).rows[0].props.onClick()
    s.render(basket).flush()
    assert.equal(JSON.parse(s.raw).schemaVersion, 1)
    assert.deepEqual(JSON.parse(s.raw).doneLineIds, [])
    assert.equal(s.render(basket).alerts.length, 0)
  } finally { s.close() }
})

test('product #1891: valid previous-basket v1 envelope can be safely replaced', () => {
  const a = week(['Di'])
  const b = week(['Wo'])
  assert.notEqual(progressStorage.shoppingListBasketKey(a), progressStorage.shoppingListBasketKey(b))
  const prior = JSON.stringify({
    schemaVersion: 1,
    basketKey: progressStorage.shoppingListBasketKey(a),
    doneLineIds: [a.lines[0].id],
  })
  const s = mount(prior)
  try {
    const first = s.render(b)
    assert.ok(first.rows.length > 0)
    assert.ok(first.rows.every(row => !row.props.className.includes('checked')))
    first.flush()
    const saved = JSON.parse(s.raw)
    assert.equal(saved.basketKey, progressStorage.shoppingListBasketKey(b))
    assert.deepEqual(saved.doneLineIds, [])
    assert.equal(s.render(b).alerts.length, 0)
    s.render(b).rows[0].props.onClick()
    s.render(b).flush()
    assert.deepEqual(JSON.parse(s.raw).doneLineIds, [b.lines[0].id])
  } finally { s.close() }
})

test('product #1891: denied localStorage property getter keeps transitions usable and then recovers', () => {
  const a = week(['Di'])
  const b = week(['Wo'])
  const s = mount(null, { denyGetter: true })
  try {
    s.render(a).flush()
    assert.match(String(s.render(a).alerts[0]?.props.children), /opslag niet beschikbaar/)
    s.render(a).rows[0].props.onClick()
    assert.match(s.render(a).rows[0].props.className, /checked/)
    s.render(a).flush()
    assert.equal(s.writes.length, 0)

    s.render(b).flush() // synchronize the new basket identity
    s.render(b).flush()
    assert.ok(s.render(b).rows.every(row => !row.props.className.includes('checked')))
    assert.match(String(s.render(b).alerts[0]?.props.children), /opslag niet beschikbaar/)

    s.denyGetter = false
    s.render(b).rows[0].props.onClick()
    s.render(b).flush()
    assert.deepEqual(JSON.parse(s.raw).doneLineIds, [b.lines[0].id])
    assert.equal(JSON.parse(s.raw).basketKey, progressStorage.shoppingListBasketKey(b))
    assert.equal(s.render(b).alerts.length, 0)
  } finally { s.close() }
})
