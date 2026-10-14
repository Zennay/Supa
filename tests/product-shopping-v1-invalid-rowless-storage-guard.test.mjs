import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { m2InitialPlan, m2Products, m2Recipes, m2Store } from '../src/data/m2Fixture.ts'
import { quantityUnitLabelNl } from '../src/lib/quantityPresentation.ts'
import * as progress from '../src/features/shopping-list/shoppingListProgress.ts'

// Invoke the actual compiled v1 ShoppingListView effect with disposable storage.
// This is a deterministic hook/effect harness, not actual Firefox hydration.
const require = createRequire(import.meta.url)
const componentSource = readFileSync(
  new URL('../src/features/shopping-list/ShoppingListView.tsx', import.meta.url), 'utf8',
)
const compiled = ts.transpileModule(componentSource, {
  fileName: 'ShoppingListView.tsx',
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])

function basket(days) {
  return buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, products: m2Products,
    recipes: m2Recipes, activeDays: days,
  })
}

function mountAndRunEffects(snapshot, originalRecord = 'PRESERVE_THESE_UNKNOWN_BYTES') {
  const effects = []
  const writes = []
  const reads = []
  const imported = name => {
    if (name === 'react') return {
      useMemo: factory => factory(),
      useState: initial => [
        typeof initial === 'function' ? initial() : initial,
        () => {},
      ],
      useEffect: fn => effects.push(fn),
    }
    if (name === 'react/jsx-runtime') return require(name)
    if (name === '../../lib/quantityPresentation') return { quantityUnitLabelNl }
    if (name === './shoppingListProgress') return progress
    throw new Error('Unexpected shopping-v1 import: ' + name)
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, imported,
  )

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const storage = {
    getItem(key) {
      reads.push(key)
      return originalRecord
    },
    setItem(key, value) { writes.push({ key, value }) },
  }
  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true, value: { localStorage: storage },
    })
    const input = structuredClone(snapshot)
    module.exports.ShoppingListView({ basket: snapshot })
    assert.deepEqual(snapshot, input, 'render cannot mutate basket')
    assert.equal(effects.length, 2, 'must execute real storage lifecycle effects')
    for (const effect of effects) effect()
    assert.deepEqual(snapshot, input, 'effects cannot mutate basket')
    return { writes, reads }
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else delete globalThis.window
  }
}

test('product v1: unsafe rowless baskets never replace previously stored progress', () => {
  const empty = basket([])
  for (const [name, variant] of [
    ['missing store name', { store: { ...empty.store, name: '' } }],
    ['format-only name', { store: { ...empty.store, name: '\u200B' } }],
    ['braille-only name', { store: { ...empty.store, name: '\u2800' } }],
    ['invalid store id', { store: { ...empty.store, id: '\u0301' } }],
    ['contradictory meal count', { selectedMealCount: 1 }],
    ['contradictory cents', { totalCents: 10 }],
  ]) {
    const candidate = { ...empty, ...variant }
    const { writes, reads } = mountAndRunEffects(candidate)
    assert.deepEqual(writes, [], name + ': no write or replacement')
    assert.ok(reads.includes(progress.shoppingListProgressStorageKey), name + ': read only')
  }
})

test('product v1: true empty week and real populated checklist keep existing v1 write contract', () => {
  const validEmpty = basket([])
  const validPopulated = basket(['Di'])
  assert.equal(validEmpty.lines.length, 0)
  assert.ok(validPopulated.lines.length > 0)
  for (const current of [validEmpty, validPopulated]) {
    const { writes } = mountAndRunEffects(current, null)
    assert.equal(writes.length, 1, 'valid v1 flow still writes exactly one snapshot')
    assert.equal(writes[0].key, progress.shoppingListProgressStorageKey)
    const record = JSON.parse(writes[0].value)
    assert.equal(record.schemaVersion, 1)
    assert.equal(record.basketKey, progress.shoppingListBasketKey(current))
    assert.deepEqual(record.doneLineIds, [])
  }
})
