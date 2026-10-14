import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import {
  m2DefaultActiveDays, m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import { buildShoppingListCopyText } from '../src/features/shopping-list/shoppingListCopyText.ts'
import { selectShoppingCopyText } from '../src/features/shopping-list/selectShoppingCopyText.ts'

// Independent QA-only user-gesture replay on the owner's original frozen
// ShoppingListCopyButton TSX. No production source or external clipboard API.
const source = readFileSync(new URL(
  '../src/features/shopping-list/ShoppingListCopyButton.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: 'ShoppingListCopyButton.tsx',
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])

function mount() {
  const require = createRequire(import.meta.url)
  const slots = []
  let index = 0
  const fakeHooks = {
    useId() { index += 1; return ':qa-copy:' },
    useRef(value) {
      const at = index++
      if (!(at in slots)) slots[at] = { current: value }
      return slots[at]
    },
    useState(value) {
      const at = index++
      if (!(at in slots)) slots[at] = value
      return [slots[at], update => {
        slots[at] = typeof update === 'function' ? update(slots[at]) : update
      }]
    },
  }
  const exports = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    exports, exports.exports, path => {
      if (path === 'react') return fakeHooks
      if (path === 'react/jsx-runtime') return require('react/jsx-runtime')
      if (path === './shoppingListCopyText') return { buildShoppingListCopyText }
      if (path === './selectShoppingCopyText') return { selectShoppingCopyText }
      if (path.endsWith('.css')) return {}
      throw new Error('Untrusted import ' + path)
    },
  )
  return (basket, doneLineIds) => {
    index = 0
    const tree = exports.exports.ShoppingListCopyButton({ basket, doneLineIds })
    const [button, status, detail] = tree.props.children
    return {
      expanded: button.props['aria-expanded'],
      label: button.props.children,
      disabled: button.props.disabled,
      detail,
      click: () => button.props.onClick(),
    }
  }
}

function basket() {
  return structuredClone(buildOneStoreBasket({
    store: m2Store, plan: m2InitialPlan, recipes: m2Recipes,
    activeDays: m2DefaultActiveDays, products: m2Products,
  }))
}

test('QA: A→B→A done-line transitions across every physical row require an actual new click', () => {
  const original = basket()
  const frozen = structuredClone(original)
  let checked = 0
  for (const line of original.lines) {
    const render = mount()
    const initial = render(original, [])
    assert.equal(initial.expanded, false)
    initial.click()
    let opened = render(original, [])
    assert.equal(opened.expanded, true)
    assert.ok(opened.detail)
    assert.match(opened.label, /Verberg kopieerbare lijst/)
    // A -> B: a checked row changes the real list text.
    const changed = render(original, [line.id])
    assert.equal(changed.expanded, false)
    assert.equal(changed.detail, false)
    // B -> A: returning to the previous exact text is NOT new consent.
    const returnToA = render(original, [])
    assert.equal(returnToA.expanded, false, line.id)
    assert.equal(returnToA.detail, false)
    assert.match(returnToA.label, /Toon kopieerbare lijst/)
    // Multiple stable renders must not spontaneously reopen it either.
    for (let i = 0; i < 3; i++) {
      assert.equal(render(original, []).expanded, false)
    }
    returnToA.click()
    opened = render(original, [])
    assert.equal(opened.expanded, true, 'a fresh click is required')
    opened.click()
    assert.equal(render(original, []).expanded, false)
    checked += 1
  }
  assert.equal(checked, original.lines.length)
  assert.ok(checked >= 10)
  assert.deepEqual(original, frozen, 'copy UI never edits price or basket data')
})

test('QA: current export selection remains visible across unchanged renders but closes on A→B→A→B', () => {
  const original = basket()
  const [first, second] = original.lines
  assert.notEqual(first.id, second.id)
  const render = mount()
  render(original, []).click()
  for (let i = 0; i < 12; i++) {
    assert.equal(render(original, []).expanded, true, 'unchanged list retains explicit consent')
  }
  assert.equal(render(original, [first.id]).expanded, false)
  assert.equal(render(original, []).expanded, false)
  const fresh = render(original, [second.id])
  assert.equal(fresh.expanded, false)
  fresh.click()
  assert.equal(render(original, [second.id]).expanded, true)
  assert.equal(render(original, [first.id]).expanded, false)
  assert.equal(render(original, [second.id]).expanded, false,
    'earlier snapshot B must also stay closed when revisited')
  assert.equal(render(original, []).expanded, false)
})

test('QA: malformed/unavailable output never reuses an earlier private text expansion', () => {
  const original = basket()
  const before = structuredClone(original)
  const render = mount()
  render(original, []).click()
  assert.equal(render(original, []).expanded, true)

  for (const invalid of [
    { store: null, lines: [] },
    { store: null, lines: [null] },
  ]) {
    const state = render(invalid, [])
    assert.equal(state.expanded, false)
    assert.equal(state.disabled, true)
    assert.equal(state.detail, false)
    state.click()
    assert.equal(render(original, []).expanded, false,
      'restoring the earlier valid basket cannot reactivate private copy')
  }
  assert.deepEqual(original, before)
  assert.doesNotMatch(
    JSON.stringify(render(original, []).detail),
    /pricePerPackCents|totalCents|publicSavingsClaimEligible|savingsCents/,
  )
})
