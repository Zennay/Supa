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

test('a changed active plan cannot silently apply a different day and candidate', () => {
  const applied = []
  const ui = makeHarness({
    onChooseRecipe(day, recipeId) { applied.push([day, recipeId]) },
  })
  ui.collect(ui.render(), 'button')[0].props.onClick()
  let tree = ui.render()
  ui.collect(tree, 'select')[0].props.onChange({ target: { value: 'Di' } })
  tree = ui.render()
  ui.collect(tree, 'select')[1].props.onChange({ target: { value: 'pasta' } })

  tree = ui.update({ activeDays: ['Wo'] })
  const selects = ui.collect(tree, 'select')
  assert.equal(selects[0].props.value, 'Wo')
  assert.equal(selects[1].props.value, 'tikka')
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview, null)
  assert.equal(ui.collect(tree, 'button').length, 2, 'only toggle and refresh, no apply')
  assert.match(JSON.stringify(tree), /planning is veranderd/)
  assert.deepEqual(applied, [])

  ui.collect(tree, 'button')[1].props.onClick()
  tree = ui.render()
  const preview = ui.collect(tree, PreviewCard)[0].props.preview
  assert.equal(preview.day, 'Wo')
  assert.equal(preview.previousRecipeId, 'pasta')
  assert.equal(preview.nextRecipeId, 'tikka')
  const buttons = ui.collect(tree, 'button')
  assert.equal(buttons.length, 2, 'toggle and explicit apply after fresh preview')
  buttons[1].props.onClick()
  assert.deepEqual(applied, [['Wo', 'tikka']])
})

test('same active day with changed current recipe cannot apply a stale alternative', () => {
  const applied = []
  const ui = makeHarness({
    onChooseRecipe(day, recipeId) { applied.push([day, recipeId]) },
  })
  ui.collect(ui.render(), 'button')[0].props.onClick()
  let tree = ui.render()
  ui.collect(tree, 'select')[1].props.onChange({ target: { value: 'pasta' } })
  tree = ui.render()
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.nextRecipeId, 'pasta')

  const changedPlan = m2InitialPlan.map((meal) =>
    meal.day === 'Ma' ? { ...meal, recipeId: 'pasta' } : meal)
  tree = ui.update({ plannedMeals: changedPlan })
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview, null)
  assert.equal(ui.collect(tree, 'button').length, 2)
  assert.deepEqual(applied, [])

  ui.collect(tree, 'button')[1].props.onClick()
  tree = ui.render()
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.previousRecipeId, 'pasta')
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.nextRecipeId, 'tikka')
  ui.collect(tree, 'button')[1].props.onClick()
  assert.deepEqual(applied, [['Ma', 'tikka']])
})

test('external current-recipe change invalidates a still-selectable proposal', () => {
  const chosen = []
  const ui = makeHarness({
    onChooseRecipe(day, recipeId) { chosen.push([day, recipeId]) },
  })
  ui.collect(ui.render(), 'button')[0].props.onClick()
  let tree = ui.render()
  ui.collect(tree, 'select')[1].props.onChange({ target: { value: 'pasta' } })
  tree = ui.render()
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.previousRecipeId, 'tikka')
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.nextRecipeId, 'pasta')

  // Another planner control changed the current Ma recipe, but pasta remains a
  // valid alternative. Valid target alone is not consent for the new baseline.
  const updated = m2InitialPlan.map((meal) =>
    meal.day === 'Ma' ? { ...meal, recipeId: 'teriyaki' } : meal)
  tree = ui.update({ plannedMeals: updated })
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview, null)
  assert.equal(ui.collect(tree, 'button').length, 2)
  assert.deepEqual(chosen, [])

  ui.collect(tree, 'button')[1].props.onClick() // explicit refresh
  tree = ui.render()
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.previousRecipeId, 'teriyaki')
  ui.collect(tree, 'select')[1].props.onChange({ target: { value: 'pasta' } })
  tree = ui.render()
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.nextRecipeId, 'pasta')
  ui.collect(tree, 'button')[1].props.onClick()
  assert.deepEqual(chosen, [['Ma', 'pasta']])
})

test('a change to another active meal invalidates a proposal for the selected day', () => {
  const applied = []
  const ui = makeHarness({
    onChooseRecipe(day, recipeId) { applied.push([day, recipeId]) },
  })
  ui.collect(ui.render(), 'button')[0].props.onClick()
  let tree = ui.render()
  ui.collect(tree, 'select')[1].props.onChange({ target: { value: 'pasta' } })
  tree = ui.render()
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.day, 'Ma')
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.nextRecipeId, 'pasta')

  // Tuesday changed elsewhere: Monday's proposed ingredient overlap has a
  // new baseline even though Monday and the candidate ID remain identical.
  const changed = m2InitialPlan.map((meal) =>
    meal.day === 'Di' ? { ...meal, recipeId: 'tikka' } : meal)
  tree = ui.update({ plannedMeals: changed })
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview, null)
  assert.equal(ui.collect(tree, 'button').length, 2, 'only refresh, never apply')
  assert.deepEqual(applied, [])
  ui.collect(tree, 'button')[1].props.onClick()
  tree = ui.render()
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.day, 'Ma')
  assert.equal(ui.collect(tree, 'button').length, 2)
})

test('malformed cyclic active day identity does not render invalid controls', () => {
  const odd = {}
  odd.self = odd
  const ui = makeHarness({ activeDays: ['Ma', odd] })
  assert.equal(ui.render(), null)
})

test('null plan entries fail closed, while inert inactive rows remain harmless', () => {
  for (const badRow of [null, undefined]) {
    const ui = makeHarness({ plannedMeals: [...m2InitialPlan, badRow] })
    const initial = ui.render()
    assert.ok(initial, 'invalid row cannot crash the collapsed panel')
    ui.collect(initial, 'button')[0].props.onClick()
    const tree = ui.render()
    assert.equal(ui.collect(tree, PreviewCard)[0].props.preview, null)
    assert.equal(ui.collect(tree, 'button').length, 1, 'untrusted plan cannot offer Apply')
  }

  // The existing basket domain deliberately ignores malformed *inactive*
  // rows whose day is undefined; the trusted active week remains unchanged.
  // Preserve that valid behavior without throwing or inventing new claims.
  for (const inertRow of [{ recipeId: 'tikka' }, 0]) {
    const ui = makeHarness({ plannedMeals: [...m2InitialPlan, inertRow] })
    const initial = ui.render()
    assert.ok(initial)
    ui.collect(initial, 'button')[0].props.onClick()
    const tree = ui.render()
    const preview = ui.collect(tree, PreviewCard)[0].props.preview
    assert.ok(preview, 'unchanged active-week proposal remains inspectable')
    assert.equal(preview.day, 'Ma')
    assert.equal(preview.previousRecipeId, 'tikka')
    assert.equal(ui.collect(tree, 'button').length, 2)
  }
})

test('changing ingredients behind the same recipe identity revokes a visible proposal', () => {
  const chosen = []
  const ui = makeHarness({
    onChooseRecipe(day, recipeId) { chosen.push([day, recipeId]) },
  })
  ui.collect(ui.render(), 'button')[0].props.onClick()
  let tree = ui.render()
  ui.collect(tree, 'select')[1].props.onChange({ target: { value: 'pasta' } })
  tree = ui.render()
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.nextRecipeId, 'pasta')

  const changed = structuredClone(m2Recipes)
  const pasta = changed.find((recipe) => recipe.id === 'pasta')
  pasta.ingredients[0].id = 'new-catalog-ingredient'
  pasta.ingredients[0].label = 'Nieuw ingrediënt'
  pasta.ingredients[0].query = 'nieuw ingredient'
  tree = ui.update({ recipes: changed })
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview, null)
  assert.match(JSON.stringify(tree), /planning is veranderd of receptgegevens zijn bijgewerkt/)
  assert.equal(ui.collect(tree, 'button').length, 2, 'cannot apply before a refreshed explanation')
  assert.deepEqual(chosen, [])

  ui.collect(tree, 'button')[1].props.onClick()
  tree = ui.render()
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.day, 'Ma')
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.nextRecipeId, 'teriyaki')
  ui.collect(tree, 'select')[1].props.onChange({ target: { value: 'pasta' } })
  tree = ui.render()
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.nextRecipeId, 'pasta')
  ui.collect(tree, 'button')[1].props.onClick()
  assert.deepEqual(chosen, [['Ma', 'pasta']])
})

test('changing an ingredient amount with unchanged recipe IDs also revokes preview', () => {
  const ui = makeHarness()
  ui.collect(ui.render(), 'button')[0].props.onClick()
  const changed = structuredClone(m2Recipes)
  const pasta = changed.find((recipe) => recipe.id === 'pasta')
  pasta.ingredients[0].amount += 1
  const tree = ui.update({ recipes: changed })
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview, null)
  assert.equal(ui.collect(tree, 'button').length, 2)
})

test('circular invalid ingredient metadata never crashes the preview identity', () => {
  const cyclic = {}
  cyclic.parent = cyclic
  const changed = structuredClone(m2Recipes)
  changed[0].ingredients[0] = cyclic
  const ui = makeHarness({ recipes: changed })
  const initial = ui.render()
  assert.ok(initial)
  ui.collect(initial, 'button')[0].props.onClick()
  const tree = ui.render()
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview, null)
  assert.equal(ui.collect(tree, 'button').length, 1)
})

test('refresh after external edit on a non-default day cannot remain stale', () => {
  const ui = makeHarness()
  ui.collect(ui.render(), 'button')[0].props.onClick()
  let tree = ui.render()
  ui.collect(tree, 'select')[0].props.onChange({ target: { value: 'Di' } })
  tree = ui.render()
  ui.collect(tree, 'select')[1].props.onChange({ target: { value: 'pasta' } })
  const changed = m2InitialPlan.map((meal) =>
    meal.day === 'Di' ? { ...meal, recipeId: 'tikka' } : meal)
  tree = ui.update({ plannedMeals: changed })
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview, null)
  assert.equal(ui.collect(tree, 'button').length, 2)
  ui.collect(tree, 'button')[1].props.onClick()
  tree = ui.render()
  assert.equal(ui.collect(tree, 'select')[0].props.value, 'Ma')
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.day, 'Ma')
  assert.equal(ui.collect(tree, 'button').length, 2, 'refreshed valid plan offers apply')
})

test('reopening a preview after selecting another day uses the fresh default day', () => {
  const ui = makeHarness()
  ui.collect(ui.render(), 'button')[0].props.onClick()
  let tree = ui.render()
  ui.collect(tree, 'select')[0].props.onChange({ target: { value: 'Di' } })
  tree = ui.render()
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.day, 'Di')
  ui.collect(tree, 'button')[0].props.onClick() // collapse
  tree = ui.render()
  ui.collect(tree, 'button')[0].props.onClick() // fresh session
  tree = ui.render()
  assert.equal(ui.collect(tree, 'select')[0].props.value, 'Ma')
  assert.equal(ui.collect(tree, PreviewCard)[0].props.preview.day, 'Ma')
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

test('invalid duplicate active day hides the entire unusable preview selector', () => {
  const ui = makeHarness({ activeDays: ['Ma', 'Ma'] })
  assert.equal(ui.render(), null)
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

test('invalid preview never offers controls or confirms a recipe change', () => {
  const chosen = []
  const ui = makeHarness({
    activeDays: ['Ma', 'Ma'],
    onChooseRecipe(day, recipeId) { chosen.push([day, recipeId]) },
  })
  const tree = ui.render()
  assert.equal(tree, null)
  assert.deepEqual(chosen, [])
})
