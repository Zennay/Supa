import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { shoppingListDemandIdentity } from '../src/features/shopping-list/shoppingListDemandIdentity.ts'
import { shoppingListRowsV2 } from '../src/features/shopping-list/shoppingListRowsV2.ts'
import { startShoppingProgressSessionV2 } from '../src/features/shopping-list/shoppingListProgressSessionV2.ts'
import { openShoppingProgressStorageV2 } from '../src/features/shopping-list/shoppingListStorageControllerV2.ts'
import { shoppingListProgressV2StorageKey } from '../src/features/shopping-list/shoppingListProgressV2.ts'

// Render the real TSX handlers with deterministic React hook slots and effects.
// This is a controlled in-process UI contract, not real Firefox hydration.
const require = createRequire(import.meta.url)
const source = readFileSync(
  new URL('../src/features/shopping-list/ShoppingListViewV2.tsx', import.meta.url), 'utf8',
)
const compiled = ts.transpileModule(source, {
  fileName: 'ShoppingListViewV2.tsx',
  compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])

function basket() {
  return buildOneStoreBasket({
    store: { ...m2Store },
    plan: m2InitialPlan,
    recipes: m2Recipes,
    products: m2Products,
    activeDays: ['Di'],
  })
}

function elements(value) {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!value || typeof value !== 'object' || !('props' in value)) return []
  return [value, ...elements(value.props.children)]
}

function visibleText(value) {
  if (Array.isArray(value)) return value.map(visibleText).join(' ')
  if (value === null || value === undefined || typeof value === 'boolean') return ''
  if (typeof value !== 'object') return String(value)
  return visibleText(value.props?.children)
}

function view(port, physical = basket()) {
  const state = []
  const effectDependencies = new Map()
  let cursor = 0
  let effects = []
  const React = {
    useState(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
      return [state[index], next => {
        state[index] = typeof next === 'function' ? next(state[index]) : next
      }]
    },
    useEffect(effect, dependencies) {
      const index = cursor++
      const previous = effectDependencies.get(index)
      if (!previous || dependencies.some((part, i) => !Object.is(part, previous[i]))) {
        effects.push(() => {
          effectDependencies.set(index, [...dependencies])
          effect()
        })
      }
    },
  }
  const dependencies = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    './shoppingListDemandIdentity.ts': { shoppingListDemandIdentity },
    './shoppingListRowsV2.ts': { shoppingListRowsV2 },
    './shoppingListProgressSessionV2.ts': { startShoppingProgressSessionV2 },
    './shoppingListStorageControllerV2.ts': { openShoppingProgressStorageV2 },
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, name => {
      assert.ok(Object.hasOwn(dependencies, name), 'Unexpected view import ' + name)
      return dependencies[name]
    },
  )
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  globalThis.window = { localStorage: port }
  let closed = false
  function render() {
    assert.equal(closed, false)
    cursor = 0
    effects = []
    const nodes = elements(module.exports.ShoppingListViewV2({ basket: physical }))
    for (const effect of effects) effect()
    return nodes
  }
  function close() {
    closed = true
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else delete globalThis.window
  }
  return { render, close }
}

function find(nodes, predicate) {
  const element = nodes.find(predicate)
  assert.ok(element, 'expected the UI action or status to exist')
  return element
}

test('QA #1603: mounted v2 view exposes protected-record warning; toggle and recheck never write', () => {
  const future = '{"schemaVersion":3,"unknownClient":"reserved"}'
  const records = new Map([[shoppingListProgressV2StorageKey, future]])
  const writes = []
  const port = {
    getItem(key) { return records.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); records.set(key, value) },
  }
  const ui = view(port)
  try {
    let nodes = ui.render()
    assert.equal(nodes.some(node => node.props['data-storage-state'] === 'unknown-record'), false)
    nodes = ui.render()
    const warning = find(nodes, node => node.props['data-storage-state'] === 'unknown-record')
    assert.equal(warning.props.role, 'status')
    assert.match(visibleText(warning), /Opgeslagen boodschappenlijst beschermd/)
    assert.match(visibleText(warning), /nieuwe vinkjes worden niet bewaard/)
    assert.ok(nodes.some(node => node.type === 'button' && /shopping-row/.test(node.props.className)))

    find(nodes, node => node.type === 'button' && /shopping-row/.test(node.props.className))
      .props.onClick()
    nodes = ui.render()
    find(nodes, node => node.type === 'button' &&
      visibleText(node).includes('Opgeslagen versie opnieuw controleren')).props.onClick()
    nodes = ui.render()
    assert.match(visibleText(find(nodes, node => node.props['data-storage-state'] === 'unknown-record')),
      /Bestaande gegevens zijn behouden/)
    assert.equal(records.get(shoppingListProgressV2StorageKey), future)
    assert.deepEqual(writes, [])
  } finally {
    ui.close()
  }
})

test('QA #1603: denied browser storage shows temporary-only warning and failed retry never writes', () => {
  const writes = []
  const port = {
    getItem() { throw new Error('synthetic denied localStorage read') },
    setItem(key, value) { writes.push([key, value]) },
  }
  const ui = view(port)
  try {
    ui.render()
    let nodes = ui.render()
    const warning = find(nodes, node => node.props['data-storage-state'] === 'unavailable')
    assert.equal(warning.props.role, 'status')
    assert.match(visibleText(warning), /Vinkjes blijven alleen tijdelijk zichtbaar/)
    find(nodes, node => node.type === 'button' &&
      visibleText(node).includes('Opgeslagen voortgang opnieuw controleren')).props.onClick()
    nodes = ui.render()
    assert.match(visibleText(find(nodes, node => node.props['data-storage-state'] === 'unavailable')),
      /tijdelijke vinkjes blijven staan/)
    assert.deepEqual(writes, [])
  } finally {
    ui.close()
  }
})

test('QA #1603: a normal mounted checklist has no hidden render-time writes; click alone saves', () => {
  const records = new Map()
  const writes = []
  const port = {
    getItem(key) { return records.get(key) ?? null },
    setItem(key, value) { writes.push([key, value]); records.set(key, value) },
  }
  const ui = view(port)
  try {
    ui.render()
    let nodes = ui.render()
    assert.equal(nodes.some(node => node.props['data-storage-state'] !== undefined), false)
    assert.deepEqual(writes, [], 'render and mount effect must not persist')
    const row = find(nodes, node => node.type === 'button' && /shopping-row/.test(node.props.className))
    assert.equal(row.props['aria-pressed'], false)
    row.props.onClick()
    nodes = ui.render()
    assert.equal(find(nodes, node => node.type === 'button' &&
      /shopping-row/.test(node.props.className)).props['aria-pressed'], true)
    assert.equal(writes.length, 1)
    assert.equal(writes[0][0], shoppingListProgressV2StorageKey)
    assert.equal(JSON.parse(writes[0][1]).schemaVersion, 2)
    assert.equal(nodes.some(node => node.props['data-storage-state'] !== undefined), false)
  } finally {
    ui.close()
  }
})
