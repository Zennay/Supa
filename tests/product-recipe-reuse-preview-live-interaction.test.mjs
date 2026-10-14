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

test('real alternative-panel JSX stays collapsed and does not replace planned meals', () => {
  const before = structuredClone(m2InitialPlan)
  const ui = makeHarness()
  let tree = ui.render()
  assert.equal(ui.collect(tree, 'button').length, 1)
  assert.equal(ui.collect(tree, 'button')[0].props.type, 'button')
  assert.equal(ui.collect(tree, 'button')[0].props['aria-expanded'], false)
  assert.equal(ui.collect(tree, 'select').length, 0)
  assert.equal(ui.collect(tree, PreviewCard).length, 0)

  ui.collect(tree, 'button')[0].props.onClick()
  tree = ui.render()
  assert.equal(ui.collect(tree, 'button')[0].props['aria-expanded'], true)
  assert.equal(ui.collect(tree, 'select').length, 2)
  assert.equal(ui.collect(tree, PreviewCard).length, 1)
  const preview = ui.collect(tree, PreviewCard)[0].props.preview
  assert.ok(preview)
  assert.equal(preview.day, 'Ma')
  assert.equal(preview.previousRecipeId, 'tikka')
  assert.equal(preview.nextRecipeId, 'teriyaki')
  assert.deepEqual(preview, previewRecipeReuseChange({
    plan: m2InitialPlan, recipes: m2Recipes, activeDays: m2DefaultActiveDays,
    day: 'Ma', recipeId: 'teriyaki',
  }))
  assert.deepEqual(m2InitialPlan, before)

  ui.collect(tree, 'button')[0].props.onClick()
  assert.equal(ui.collect(ui.render(), PreviewCard).length, 0)
})

test('day and recipe choices preview without committing selection or changing money', () => {
  const ui = makeHarness()
  ui.collect(ui.render(), 'button')[0].props.onClick()
  let tree = ui.render()
  const selects = ui.collect(tree, 'select')
  selects[0].props.onChange({ target: { value: 'Di' } })
  tree = ui.render()
  const [daySelect, recipeSelect] = ui.collect(tree, 'select')
  assert.equal(daySelect.props.value, 'Di')
  assert.equal(recipeSelect.props.value, 'tikka')
  recipeSelect.props.onChange({ target: { value: 'pasta' } })
  tree = ui.render()
  const preview = ui.collect(tree, PreviewCard)[0].props.preview
  assert.equal(preview.day, 'Di')
  assert.equal(preview.previousRecipeId, 'teriyaki')
  assert.equal(preview.nextRecipeId, 'pasta')
  assert.equal('price' in preview, false)
  assert.equal('savings' in preview, false)
  assert.equal(m2InitialPlan.find(meal => meal.day === 'Di').recipeId, 'teriyaki')
})

test('a changed active plan drops the old day and candidate without stale preview', () => {
  const ui = makeHarness()
  ui.collect(ui.render(), 'button')[0].props.onClick()
  let tree = ui.render()
  ui.collect(tree, 'select')[0].props.onChange({ target: { value: 'Di' } })
  tree = ui.render()
  ui.collect(tree, 'select')[1].props.onChange({ target: { value: 'pasta' } })
  tree = ui.update({ activeDays: ['Wo'] })
  const selects = ui.collect(tree, 'select')
  assert.equal(selects[0].props.value, 'Wo')
  assert.equal(selects[1].props.value, 'tikka')
  const preview = ui.collect(tree, PreviewCard)[0].props.preview
  assert.equal(preview.day, 'Wo')
  assert.equal(preview.previousRecipeId, 'pasta')
  assert.equal(preview.nextRecipeId, 'tikka')
})

test('invalid or empty week exposes no fake preview controls', () => {
  const examples = [
    { activeDays: [] },
    { plannedMeals: [] },
    { recipes: [m2Recipes[0]] },
    { activeDays: ['no-such-day'] },
  ]
  for (const props of examples) {
    const ui = makeHarness(props)
    assert.equal(ui.render(), null)
  }
})

test('invalid duplicate active day still fails closed after opening panel', () => {
  const ui = makeHarness({ activeDays: ['Ma', 'Ma'] })
  const button = ui.collect(ui.render(), 'button')[0]
  assert.ok(button)
  button.props.onClick()
  const preview = ui.collect(ui.render(), PreviewCard)[0].props.preview
  assert.equal(preview, null)
})

test('accessible touch controls and narrow text are enforced by original CSS', () => {
  const css = readFileSync(
    new URL('../src/features/planner/recipe-reuse-preview-panel.css', import.meta.url), 'utf8',
  )
  assert.match(source, /aria-expanded=\{expanded\}/)
  assert.match(source, /type="button"/)
  assert.match(source, /aria-controls="recipe-reuse-preview-content"/)
  assert.match(source, /<label htmlFor="reuse-preview-day">/)
  assert.match(source, /<label htmlFor="reuse-preview-recipe">/)
  assert.match(source, /planning blijft hetzelfde/)
  assert.match(css, /min-height:\s*44px/)
  assert.match(css, /font-size:\s*1rem/)
  assert.match(css, /overflow-wrap:\s*anywhere/)
})

test('the chosen recipe only changes after an explicit validated confirmation', () => {
  const applied = []
  const before = structuredClone(m2InitialPlan)
  const ui = makeHarness({
    onChooseRecipe(day, recipeId) { applied.push({ day, recipeId }) },
  })
  let tree = ui.render()
  ui.collect(tree, 'button')[0].props.onClick()
  tree = ui.render()
  assert.equal(applied.length, 0)
  const fields = ui.collect(tree, 'select')
  fields[0].props.onChange({ target: { value: 'Di' } })
  tree = ui.render()
  ui.collect(tree, 'select')[1].props.onChange({ target: { value: 'pasta' } })
  tree = ui.render()
  assert.equal(applied.length, 0, 'preview controls never commit')
  const buttons = ui.collect(tree, 'button')
  assert.equal(buttons.length, 2)
  assert.equal(buttons[1].props.type, 'button')
  assert.match([buttons[1].props.children].flat().join(''), /Kies Romige tomatenpasta voor Di/)
  buttons[1].props.onClick()
  assert.deepEqual(applied, [{ day: 'Di', recipeId: 'pasta' }])
  assert.equal(ui.collect(ui.render(), 'select').length, 0, 'confirmation closes the proposal')
  assert.deepEqual(m2InitialPlan, before, 'parent callback alone owns the actual update')
})

test('invalid preview does not offer a confirm action', () => {
  const chosen = []
  const ui = makeHarness({
    activeDays: ['Ma', 'Ma'],
    onChooseRecipe(day, recipeId) { chosen.push([day, recipeId]) },
  })
  ui.collect(ui.render(), 'button')[0].props.onClick()
  const tree = ui.render()
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview, null)
  assert.equal(ui.collect(tree, 'button').length, 1)
  assert.deepEqual(chosen, [])
})
