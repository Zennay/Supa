import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

import { buildOneStoreBasket } from '../src/domain/basket.ts'
import { compareFullBaskets } from '../src/domain/basketComparison.ts'
import { defaultPlannerPreferences, serializePlannerPreferences } from '../src/domain/plannerPreferences.ts'
import { restorePlannerPreferencesWithCustomBudget } from '../src/features/planner/customWeekBudget.ts'
import {
  m2InitialPlan, m2Products, m2Recipes, m2Store,
} from '../src/data/m2Fixture.ts'
import {
  m3BaselineProducts, m3BaselineStore, m3CandidateProducts, m3CandidateStore,
} from '../src/data/m3ComparisonFixture.ts'

// Independent QA uses the *real App.tsx* compiled callbacks and preference
// serialization, with a deterministic synchronous React hook harness. This
// validates route/storage wiring; it is NOT a real browser hydration test.
const require = createRequire(import.meta.url)
const compiled = ts.transpileModule(
  readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  {
    fileName: 'App.tsx',
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  },
)
assert.deepEqual(compiled.diagnostics, [])

function memoryStorage(records = [], policy = {}) {
  const entries = new Map(records)
  const calls = { reads: [], writes: [] }
  return {
    entries, calls,
    getItem(key) {
      calls.reads.push(key)
      if (policy.denyRead) throw Error('privacy-mode storage denied')
      return entries.get(key) ?? null
    },
    setItem(key, value) {
      calls.writes.push(key)
      if (policy.denyWrite) throw Error('privacy-mode storage denied')
      entries.set(key, value)
    },
  }
}

const KEY = 'supa:planner-preferences:v2'
function mountApp(storage) {
  const slots = []
  let index = 0
  const useState = initial => {
    const position = index++
    if (!(position in slots)) slots[position] = typeof initial === 'function' ? initial() : initial
    return [slots[position], value => {
      slots[position] = typeof value === 'function' ? value(slots[position]) : value
    }]
  }
  const hooks = {
    useState,
    useMemo: evaluate => evaluate(),
    useEffect: effect => effect(),
  }
  const PlannerView = () => null
  const fixtures = { m2InitialPlan, m2Products, m2Recipes, m2Store }
  const m3Fixtures = {
    m3BaselineProducts, m3BaselineStore, m3CandidateProducts, m3CandidateStore,
  }
  const dependencies = new Map([
    ['react', hooks],
    ['react/jsx-runtime', require('react/jsx-runtime')],
    ['./features/planner/PlannerView', { PlannerView }],
    ['./features/basket/BasketView', { BasketView() {} }],
    ['./features/shopping-list/ShoppingListView', { ShoppingListView() {} }],
    ['./features/observation/ObservationView', { ObservationView() {} }],
    ['./domain/basket', { buildOneStoreBasket }],
    ['./domain/basketComparison', { compareFullBaskets }],
    ['./domain/plannerPreferences', { defaultPlannerPreferences, serializePlannerPreferences }],
    ['./features/planner/customWeekBudget.ts', { restorePlannerPreferencesWithCustomBudget }],
    ['./data/m2Fixture', fixtures],
    ['./data/m3ComparisonFixture', m3Fixtures],
  ])
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, key => {
      assert.ok(dependencies.has(key), 'unexpected App dependency: ' + key)
      return dependencies.get(key)
    },
  )

  function walk(tree) {
    if (Array.isArray(tree)) return tree.flatMap(walk)
    if (tree === null || typeof tree !== 'object' || !('props' in tree)) return []
    return [tree, ...walk(tree.props.children)]
  }
  function render() {
    index = 0
    const elements = walk(module.exports.App())
    const planner = elements.find(element => element.type === PlannerView)
    assert.ok(planner, 'App routes to PlannerView')
    return planner.props
  }

  return { render }
}

function withStorage(storage, run) {
  const prior = globalThis.window
  globalThis.window = { localStorage: storage }
  try { return run() } finally {
    if (prior === undefined) delete globalThis.window
    else globalThis.window = prior
  }
}

test('QA #1424: App custom budget event persists exact euros and remount restores it, without touching v1', () => {
  const disk = memoryStorage([['supa:planner-preferences:v1', 'legacy-byte-preserve']])
  withStorage(disk, () => {
    const app = mountApp(disk)
    const initial = app.render()
    assert.equal(initial.budget, 35)
    initial.onRecipeChange('Ma', 'pasta')
    initial.onToggleDay('Di')
    app.render()
    for (const budget of [27.5, 42.75, 0.01, 1000]) {
      app.render().onBudgetChange(budget)
      const updated = app.render()
      assert.equal(updated.budget, budget)
      const stored = JSON.parse(disk.entries.get(KEY))
      assert.equal(stored.budget, budget)
      assert.equal(stored.recipeByDay.Ma, 'pasta')
      assert.equal(stored.activeDays.includes('Di'), false)
      const rebooted = mountApp(disk).render()
      assert.equal(rebooted.budget, budget)
      assert.equal(rebooted.plannedMeals.find(meal => meal.day === 'Ma').recipeId, 'pasta')
    }
    assert.equal(disk.entries.get('supa:planner-preferences:v1'), 'legacy-byte-preserve')
    assert.ok(disk.calls.reads.every(key => key === KEY), 'only the canonical v2 preferences key is read')
    assert.ok(disk.calls.writes.every(key => key === KEY), 'only the canonical v2 preferences key is written')
  })
})

test('QA #1424: invalid persisted custom budget fails closed but keeps valid chosen recipes', () => {
  for (const budget of [-5, 0, 1000.01, 27.501, null, '27,50', true]) {
    const disk = memoryStorage([[KEY, JSON.stringify({
      budget, activeDays: ['Ma', 'Wo'], recipeByDay: { Ma: 'pasta', Wo: 'teriyaki' },
    })]])
    withStorage(disk, () => {
      const restored = mountApp(disk).render()
      assert.equal(restored.budget, 35, String(budget))
      assert.deepEqual(restored.activeDays, ['Ma', 'Wo'])
      assert.equal(restored.plannedMeals.find(meal => meal.day === 'Ma').recipeId, 'pasta')
      assert.equal(restored.plannedMeals.find(meal => meal.day === 'Wo').recipeId, 'teriyaki')
    })
  }
})

test('QA #1424: corrupt JSON and denied storage do not crash the App or invent saved budget', () => {
  for (const [raw, policy] of [['{bad', {}], [null, { denyRead:true }], [null, { denyWrite:true }]]) {
    const disk = memoryStorage(raw === null ? [] : [[KEY, raw]], policy)
    withStorage(disk, () => {
      const app = mountApp(disk)
      assert.equal(app.render().budget, 35)
      app.render().onBudgetChange(27.5)
      assert.equal(app.render().budget, 27.5)
      if (policy.denyWrite) assert.equal(disk.entries.has(KEY), false)
    })
  }
})

test('QA #1424: reset replaces custom amount and meal changes with deterministic week defaults', () => {
  const disk = memoryStorage()
  withStorage(disk, () => {
    const app = mountApp(disk)
    app.render().onBudgetChange(42.75)
    app.render().onToggleDay('Ma')
    app.render().onReset()
    const reset = app.render()
    assert.equal(reset.budget, 35)
    assert.deepEqual(reset.activeDays, ['Ma', 'Di', 'Wo', 'Do'])
    assert.equal(JSON.parse(disk.entries.get(KEY)).budget, 35)
    assert.equal(mountApp(disk).render().budget, 35)
  })
})
