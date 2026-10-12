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

test('QA #1891: external future schema inserted between render and initial effect remains untouched', () => {
  const week = basket(['Di'])
  const s = session(null)
  try {
    const initial = s.render(week)
    const future = JSON.stringify({ schemaVersion: 12, doneLineIds: ['another-app'] })
    s.raw = future
    initial.flush()
    assert.equal(s.raw, future)
    assert.equal(s.writes.length, 0)
    assertAlert(s, week, /eerdere opgeslagen gegevens/)
  } finally { s.close() }
})

test('QA #1891: external corrupt replacement after valid mount is protected across two rapid toggles', () => {
  const week = basket(['Di'])
  const s = session(accepted(storage.shoppingListBasketKey(week), []))
  try {
    s.render(week).flush()
    assert.equal(s.render(week).alerts.length, 0)
    const corrupt = '{ externally interrupted write'
    s.raw = corrupt
    const row = s.render(week).buttons[0]
    assert.ok(row)
    row.props.onClick()
    row.props.onClick()
    s.render(week).flush()
    assert.equal(s.raw, corrupt)
    assertAlert(s, week, /eerdere opgeslagen gegevens/)
    // The protected record can never be replaced by a stale progress snapshot.
    assert.equal(s.writes.length, 1)
  } finally { s.close() }
})

test('QA #1891: structurally unsupported v1 records are never silently downgraded', () => {
  const week = basket(['Wo'])
  const key = storage.shoppingListBasketKey(week)
  for (const raw of [
    'null', '[]', '"string"',
    JSON.stringify({ schemaVersion: 1, basketKey: key, doneLineIds: 'bad' }),
    JSON.stringify({ schemaVersion: 1, basketKey: key, doneLineIds: [3] }),
    JSON.stringify({ schemaVersion: 1, basketKey: key, doneLineIds: [], metadata: { extra: true } }),
    JSON.stringify({ schemaVersion: 7, basketKey: key, doneLineIds: [] }),
  ]) {
    const s = session(raw)
    try {
      s.render(week).flush()
      const row = s.render(week).buttons[0]
      assert.ok(row)
      row.props.onClick()
      s.render(week).flush()
      assert.equal(s.raw, raw)
      assert.equal(s.writes.length, 0)
      assertAlert(s, week, /eerdere opgeslagen gegevens/)
    } finally { s.close() }
  }
})

test('QA #1891: write denial is explicit and a later successful user action clears warning', () => {
  const week = basket(['Di'])
  const s = session(null, { write: true })
  try {
    s.render(week).flush()
    assertAlert(s, week, /opslag niet beschikbaar/)
    s.render(week).buttons[0].props.onClick()
    assert.match(s.render(week).buttons[0].props.className, /checked/)
    s.render(week).flush()
    assertAlert(s, week, /opslag niet beschikbaar/)
    s.writeDenied = false
    s.render(week).buttons[0].props.onClick()
    s.render(week).flush()
    assert.equal(s.render(week).alerts.length, 0)
    assert.equal(JSON.parse(s.raw).schemaVersion, 1)
    assert.deepEqual(JSON.parse(s.raw).doneLineIds, [])
  } finally { s.close() }
})

test('QA #1891: recovered denied reads permit a later explicit persisted tick', () => {
  const week = basket(['Di'])
  const s = session(null, { read: true })
  try {
    s.render(week).flush()
    assertAlert(s, week, /opslag niet beschikbaar/)
    s.readDenied = false
    const row = s.render(week).buttons[0]
    row.props.onClick()
    s.render(week).flush()
    assert.equal(s.render(week).alerts.length, 0)
    assert.deepEqual(JSON.parse(s.raw).doneLineIds, [week.lines[0].id])
  } finally { s.close() }
})

test('QA #1891: a protected record remains untouched through basket changes', () => {
  const tuesday = basket(['Di'])
  const wednesday = basket(['Wo'])
  assert.notEqual(storage.shoppingListBasketKey(tuesday), storage.shoppingListBasketKey(wednesday))
  const future = JSON.stringify({ schemaVersion: 99, foreign: 'preserve' })
  const s = session(future)
  try {
    s.render(tuesday).flush()
    s.render(tuesday).buttons[0].props.onClick()
    s.render(tuesday).flush()
    assertAlert(s, tuesday, /eerdere opgeslagen gegevens/)
    // First new render schedules the state-key transition; second render uses it.
    s.render(wednesday).flush()
    s.render(wednesday).flush()
    const newRows = s.render(wednesday).buttons
    assert.ok(newRows.length > 0)
    assert.ok(newRows.every(row => !row.props.className.includes('checked')))
    newRows[0].props.onClick()
    s.render(wednesday).flush()
    assert.equal(s.raw, future)
    assert.equal(s.writes.length, 0)
    assertAlert(s, wednesday, /eerdere opgeslagen gegevens/)
  } finally { s.close() }
})

test('QA #1891: valid persisted v1 checkmarks show no false unsaved warning', () => {
  const week = basket(['Di'])
  const line = week.lines[0]
  assert.ok(line)
  const s = session(accepted(storage.shoppingListBasketKey(week), [line.id]))
  try {
    const first = s.render(week)
    assert.match(first.buttons[0].props.className, /checked/)
    first.flush()
    assert.equal(s.render(week).alerts.length, 0)
    first.buttons[0].props.onClick()
    s.render(week).flush()
    assert.deepEqual(JSON.parse(s.raw).doneLineIds, [])
    assert.equal(s.render(week).alerts.length, 0)
  } finally { s.close() }
})
