import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'
import { previewRecipeReuseChange } from '../src/domain/ingredientReusePreview.ts'

const file = new URL('../src/features/planner/RecipeReusePreviewPanel.tsx', import.meta.url)
const source = readFileSync(file, 'utf8')
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
const PreviewCard = () => null

function makeHarness(initialProps = {}) {
  let props = {
    plannedMeals: m2InitialPlan,
    activeDays: m2DefaultActiveDays,
    recipes: m2Recipes,
    ...initialProps,
  }
  const state = []
  let cursor = 0
  const react = {
    useState(initial) {
      const index = cursor++
      if (!Object.hasOwn(state, index)) state[index] = initial
      return [state[index], (next) => {
        state[index] = typeof next === 'function' ? next(state[index]) : next
      }]
    },
  }
  const modules = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '../../domain/ingredientReusePreview.ts': { previewRecipeReuseChange },
    './IngredientReusePreviewCard.tsx': { IngredientReusePreviewCard: PreviewCard },
    './recipe-reuse-preview-panel.css': {},
  }
  const module = { exports: {} }
  new Function('module', 'exports', 'require', compiled.outputText)(
    module, module.exports, (name) => {
      assert.ok(Object.hasOwn(modules, name), 'Unexpected dependency: ' + name)
      return modules[name]
    },
  )
  function render() {
    cursor = 0
    return module.exports.RecipeReusePreviewPanel(props)
  }
  function collect(root, type, result = []) {
    if (Array.isArray(root)) {
      for (const node of root) collect(node, type, result)
    } else if (root && typeof root === 'object') {
      if (root.type === type) result.push(root)
      collect(root.props?.children, type, result)
    }
    return result
  }
  return {
    render,
    collect,
    update(next) { props = { ...props, ...next }; return render() },
  }
}

test('ambiguous source and alternative recipe identities never render selectors', () => {
  for (const duplicateId of ['tikka', 'teriyaki', 'pasta']) {
    const onChoose = []
    const recipes = [...m2Recipes, { ...m2Recipes.find((recipe) => recipe.id === duplicateId), title: 'Conflicterend recept' }]
    const ui = makeHarness({
      recipes,
      onChooseRecipe(day, recipeId) { onChoose.push([day, recipeId]) },
    })
    assert.equal(ui.render(), null, 'duplicate id ' + duplicateId + ' must fail closed')
    assert.deepEqual(onChoose, [])
    assert.equal(m2Recipes.length, 3, 'source catalog is not mutated')
  }
})

test('missing or non-text recipe titles cannot crash React options', () => {
  for (const title of [null, undefined, 42, {}, [], '', '   ']) {
    const recipes = structuredClone(m2Recipes)
    recipes[1].title = title
    const ui = makeHarness({ recipes })
    assert.doesNotThrow(() => ui.render())
    assert.equal(ui.render(), null, 'unrenderable title ' + String(title))
  }
  const ui = makeHarness({ recipes: [...m2Recipes, null] })
  assert.equal(ui.render(), null, 'null catalog rows must fail closed')
})

test('padded recipe or active-day identities and vanished current recipe fail closed', () => {
  const paddedRecipes = structuredClone(m2Recipes)
  paddedRecipes[1].id += ' '
  assert.equal(makeHarness({ recipes: paddedRecipes }).render(), null)
  assert.equal(makeHarness({ activeDays: ['Ma ', 'Di'] }).render(), null)
  assert.equal(makeHarness({
    plannedMeals: m2InitialPlan.map((meal) =>
      meal.day === 'Ma' ? { ...meal, recipeId: 'missing-recipe' } : meal),
  }).render(), null)
})

test('valid exact identities still permit explicit consent without mutating input', () => {
  const snapshot = structuredClone(m2InitialPlan)
  const chosen = []
  const ui = makeHarness({
    onChooseRecipe(day, recipeId) { chosen.push([day, recipeId]) },
  })
  let tree = ui.render()
  assert.ok(tree)
  ui.collect(tree, 'button')[0].props.onClick()
  tree = ui.render()
  assert.equal(ui.collect(tree, 'select').length, 2)
  const preview = ui.collect(tree, PreviewCard)[0].props.preview
  assert.equal(preview.day, 'Ma')
  assert.equal(preview.previousRecipeId, 'tikka')
  assert.equal(preview.nextRecipeId, 'teriyaki')
  assert.deepEqual(chosen, [])
  ui.collect(tree, 'button')[1].props.onClick()
  assert.deepEqual(chosen, [['Ma', 'teriyaki']])
  assert.deepEqual(m2InitialPlan, snapshot)
})
