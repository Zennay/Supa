import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'
import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2Store, m2Recipes, m2Products, m2InitialPlan } from '../src/data/m2Fixture.ts'
import { quantityUnitLabelNl } from '../src/lib/quantityPresentation.ts'
import * as persisted from '../src/features/shopping-list/shoppingListProgress.ts'

// Product #1887 independent postrepair acceptance: compiled real ShoppingListView,
// synthetic M2 fixtures, disposable memory storage. No real browser/store data.
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
const validRecord = (current, ids = []) => JSON.stringify({
  schemaVersion: 1,
  basketKey: persisted.shoppingListBasketKey(current),
  doneLineIds: ids,
})
function allNodes(node) {
  if (Array.isArray(node)) return node.flatMap(allNodes)
  if (!node || typeof node !== 'object' || !('props' in node)) return []
  return [node, ...allNodes(node.props.children)]
}
function app(initial) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const slots = []
  const writes = []
  let stored = initial
  let rejectReads = false
  let hook = 0
  let effects = []
  const storage = {
    getItem(key) {
      assert.equal(key, persisted.shoppingListProgressStorageKey)
      if (rejectReads) throw Error('synthetic storage read denied')
      return stored
    },
    setItem(key, value) {
      assert.equal(key, persisted.shoppingListProgressStorageKey)
      stored = value
      writes.push(value)
    },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true, value: { localStorage: storage },
  })
  const imports = name => {
    if (name === 'react') return {
      useMemo: callback => callback(),
      useEffect: callback => effects.push(callback),
      useState(initializer) {
        const index = hook++
        if (!(index in slots)) slots[index] = typeof initializer === 'function' ? initializer() : initializer
        return [slots[index], value => {
          slots[index] = typeof value === 'function' ? value(slots[index]) : value
        }]
      },
    }
    if (name === 'react/jsx-runtime') return nativeRequire(name)
    if (name === '../../lib/quantityPresentation') return { quantityUnitLabelNl }
    if (name === './shoppingListProgress') return persisted
    throw Error('Unknown production import ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, imports,
  )
  return {
    render(current) {
      hook = 0
      effects = []
      const tree = module.exports.ShoppingListView({ basket: current })
      const flush = [...effects]
      return {
        rows: allNodes(tree).filter(node =>
          node.type === 'button' && node.props.className?.split(' ').includes('shopping-row')),
        statuses: allNodes(tree).filter(node => node.props.role === 'status'),
        flush() { for (const effect of flush) effect() },
      }
    },
    get raw() { return stored },
    set raw(value) { stored = value },
    set denyRead(value) { rejectReads = value },
    writes,
    close() {
      if (previous) Object.defineProperty(globalThis, 'window', previous)
      else delete globalThis.window
    },
  }
}

test('postrepair #1887: protected record introduced after render is rechecked at write time', () => {
  const week = basket(['Di'])
  const frozen = structuredClone(week)
  const session = app(null)
  const protectedRaw = JSON.stringify({ schemaVersion: 9, privateClientState: 'future' })
  try {
    const first = session.render(week)
    session.raw = protectedRaw
    first.flush()
    assert.equal(session.raw, protectedRaw)
    first.rows[0].props.onClick()
    session.render(week).flush()
    assert.equal(session.raw, protectedRaw)
    assert.deepEqual(session.writes, [])
    assert.deepEqual(week, frozen)
  } finally { session.close() }
})

test('postrepair #1887: removing future record allows a later explicit click to save current session', () => {
  const week = basket(['Di'])
  const future = JSON.stringify({ schemaVersion: 4, basketKey: 'future', doneLineIds: ['x'] })
  const session = app(future)
  try {
    const first = session.render(week)
    first.flush()
    first.rows[0].props.onClick()
    session.render(week).flush()
    assert.equal(session.raw, future)
    assert.deepEqual(session.writes, [])
    session.raw = null // external consent/recovery clears the key, not automatic migration
    session.render(week).rows[1].props.onClick()
    session.render(week).flush()
    assert.equal(JSON.parse(session.raw).schemaVersion, 1)
    assert.deepEqual(new Set(JSON.parse(session.raw).doneLineIds),
      new Set([week.lines[0].id, week.lines[1].id]))
  } finally { session.close() }
})

test('postrepair #1887: a valid previous basket remains replaceable after physical demand changes', () => {
  const tuesday = basket(['Di'])
  const wednesday = basket(['Wo'])
  const session = app(validRecord(tuesday, [tuesday.lines[0].id]))
  try {
    session.render(wednesday).flush()
    assert.equal(JSON.parse(session.raw).basketKey, persisted.shoppingListBasketKey(wednesday))
    assert.deepEqual(JSON.parse(session.raw).doneLineIds, [])
    assert.equal(session.writes.length, 1)
  } finally { session.close() }
})

test('postrepair #1887: extra unsupported v1 metadata is preserved on a genuinely empty week', () => {
  const empty = basket([])
  const foreign = JSON.stringify({
    schemaVersion: 1, basketKey: persisted.shoppingListBasketKey(empty),
    doneLineIds: [], futureMetadata: { retains: 'opaque' },
  })
  const session = app(foreign)
  try {
    const rendered = session.render(empty)
    assert.equal(rendered.rows.length, 0)
    assert.equal(rendered.statuses.length, 1)
    assert.match(String(rendered.statuses[0].props.children), /Geen boodschappen/)
    rendered.flush()
    assert.equal(session.raw, foreign)
    assert.deepEqual(session.writes, [])
  } finally { session.close() }
})

test('postrepair #1887: storage read denial cannot trigger an overwrite or break local toggles', () => {
  const week = basket(['Di'])
  const session = app(validRecord(week))
  try {
    session.denyRead = true
    const initial = session.render(week)
    initial.flush()
    initial.rows[0].props.onClick()
    const latest = session.render(week)
    assert.match(latest.rows[0].props.className, /\bchecked\b/)
    latest.flush()
    assert.deepEqual(session.writes, [])
  } finally { session.close() }
})
