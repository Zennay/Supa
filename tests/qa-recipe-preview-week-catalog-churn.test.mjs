import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { previewRecipeReuseChange } from '../src/domain/ingredientReusePreview.ts'

// Independent quality-validation on the actual new #1099 TSX. Unlike a
// source-text assertion this renders real panel handlers and React-like state
// transitions, while stubbing only the purely presentational child card.
const source = readFileSync(
  new URL('../src/features/planner/RecipeReusePreviewPanel.tsx', import.meta.url),
  'utf8',
)
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: 'RecipeReusePreviewPanel.tsx',
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])

const jsx = (type, props) => ({ type, props })
const Card = () => null

function createHarness(nextProps = {}) {
  let props = {
    plannedMeals: m2InitialPlan,
    activeDays: m2DefaultActiveDays,
    recipes: m2Recipes,
    ...nextProps,
  }
  const state = []
  let cursor = 0
  const react = {
    useState(initial) {
      const slot = cursor++
      if (!Object.hasOwn(state, slot)) state[slot] = initial
      return [state[slot], (next) => {
        state[slot] = typeof next === 'function' ? next(state[slot]) : next
      }]
    },
  }
  const dependencies = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '../../domain/ingredientReusePreview.ts': { previewRecipeReuseChange },
    './IngredientReusePreviewCard.tsx': { IngredientReusePreviewCard: Card },
    './recipe-reuse-preview-panel.css': {},
  }
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    mod, mod.exports, (id) => {
      assert.ok(Object.hasOwn(dependencies, id), 'unknown module ' + id)
      return dependencies[id]
    },
  )

  function render() {
    cursor = 0
    return mod.exports.RecipeReusePreviewPanel(props)
  }
  function nodes(root, type, output = []) {
    if (Array.isArray(root)) {
      for (const node of root) nodes(node, type, output)
    } else if (root && typeof root === 'object') {
      if (root.type === type) output.push(root)
      nodes(root.props?.children, type, output)
    }
    return output
  }
  return {
    render,
    nodes,
    update(changes) { props = { ...props, ...changes }; return render() },
  }
}

function openOnDay(ui, selectedDay, chosenRecipe) {
  let tree = ui.render()
  ui.nodes(tree, 'button')[0].props.onClick()
  tree = ui.render()
  const days = ui.nodes(tree, 'select')
  assert.equal(days.length, 2)
  days[0].props.onChange({ target: { value: selectedDay } })
  tree = ui.render()
  ui.nodes(tree, 'select')[1].props.onChange({ target: { value: chosenRecipe } })
  tree = ui.render()
  const preview = ui.nodes(tree, Card)[0].props.preview
  assert.equal(preview?.day, selectedDay)
  assert.equal(preview.nextRecipeId, chosenRecipe)
  assert.equal(ui.nodes(tree, 'button').length, 2, 'toggle and explicit Apply')
  return tree
}

test('every selected day rejects cross-day planner edits until a new preview', async (t) => {
  const sourceSnapshot = structuredClone(m2InitialPlan)
  const active = m2DefaultActiveDays
  for (const selectedDay of active) {
    await t.test('selected=' + selectedDay, () => {
      const onChoose = []
      const ui = createHarness({
        onChooseRecipe(day, id) { onChoose.push([day, id]) },
      })
      const current = m2InitialPlan.find((meal) => meal.day === selectedDay).recipeId
      const candidate = m2Recipes.find((recipe) => recipe.id !== current).id
      openOnDay(ui, selectedDay, candidate)

      const otherDay = active.find((day) => day !== selectedDay)
      const changed = m2InitialPlan.map((meal) => meal.day === otherDay
        ? { ...meal, recipeId: meal.recipeId === 'tikka' ? 'pasta' : 'tikka' }
        : meal)
      const stale = ui.update({ plannedMeals: changed })
      assert.equal(ui.nodes(stale, Card)[0].props.preview, null)
      assert.equal(ui.nodes(stale, 'button').length, 2, 'stale Apply replaced by refresh')
      assert.match(JSON.stringify(stale), /Werk voorbeeld bij/)
      assert.deepEqual(onChoose, [])

      ui.nodes(stale, 'button')[1].props.onClick()
      const fresh = ui.render()
      const preview = ui.nodes(fresh, Card)[0].props.preview
      assert.ok(preview, 'the refreshed real plan remains usable')
      assert.equal(preview.day, active[0], 'refresh restarts from an explicit fresh day')
      assert.equal(ui.nodes(fresh, 'button').length, 2)
      assert.deepEqual(onChoose, [], 'refresh is not a mutation')

      ui.nodes(fresh, 'button')[1].props.onClick()
      assert.deepEqual(onChoose, [[preview.day, preview.nextRecipeId]],
        'only a post-refresh Apply is authorized')
    })
  }
  assert.deepEqual(m2InitialPlan, sourceSnapshot, 'tests never edit real fixtures')
})

test('all current catalog recipe display names invalidate unconfirmed Apply', async (t) => {
  for (const id of m2Recipes.map((recipe) => recipe.id)) {
    await t.test('renamed=' + id, () => {
      const onChoose = []
      const ui = createHarness({
        onChooseRecipe(day, recipeId) { onChoose.push([day, recipeId]) },
      })
      openOnDay(ui, 'Ma', 'pasta')
      const altered = structuredClone(m2Recipes)
      altered.find((recipe) => recipe.id === id).title += ' (gewijzigd)'
      const stale = ui.update({ recipes: altered })
      assert.equal(ui.nodes(stale, Card)[0].props.preview, null)
      assert.equal(ui.nodes(stale, 'button').length, 2)
      assert.deepEqual(onChoose, [])
      ui.nodes(stale, 'button')[1].props.onClick()
      const refreshed = ui.render()
      assert.ok(ui.nodes(refreshed, Card)[0].props.preview)
      assert.deepEqual(onChoose, [])
    })
  }
})

test('all ingredient catalog updates revoke stale recipe-change consent', async (t) => {
  for (const id of m2Recipes.map((recipe) => recipe.id)) {
    await t.test('ingredient=' + id, () => {
      const ui = createHarness()
      openOnDay(ui, 'Ma', 'pasta')
      const altered = structuredClone(m2Recipes)
      altered.find((recipe) => recipe.id === id).ingredients[0].query += ' bijgewerkt'
      const stale = ui.update({ recipes: altered })
      assert.equal(ui.nodes(stale, Card)[0].props.preview, null)
      assert.equal(ui.nodes(stale, 'button').length, 2, 'Apply must not survive catalog changes')
      assert.match(JSON.stringify(stale), /receptgegevens zijn bijgewerkt/)
    })
  }
})
