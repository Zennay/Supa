import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

import { buildIngredientReuseInsight } from '../src/domain/ingredientReuse.ts'
import { m2DefaultActiveDays, m2InitialPlan, m2Recipes } from '../src/data/m2Fixture.ts'

const require = createRequire(import.meta.url)

async function loadComponent() {
  const source = await readFile(
    new URL('../src/features/planner/IngredientReuseCard.tsx', import.meta.url),
    'utf8',
  )
  // Compile the *actual* TSX component for Node SSR. Browser CSS remains
  // separate from server-rendered markup.
  const withoutCss = source.replace(/^import '\.\/ingredient-reuse\.css'\s*$/m, '')
  const compiled = ts.transpileModule(withoutCss, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(
    require,
    module,
    module.exports,
  )
  return module.exports.IngredientReuseCard
}

test('actual React card SSR announces real active-week ingredient overlaps, without money claims', async () => {
  const Component = await loadComponent()
  const insight = buildIngredientReuseInsight({
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
  })
  const html = renderToStaticMarkup(createElement(Component, { insight }))
  assert.match(html, /Ingrediënten opnieuw gebruiken/)
  assert.match(html, /Basmati rijst/)
  assert.match(html, /3 maaltijden/)
  assert.match(html, /Ma, Di, Do/)
  assert.match(html, /geen restjes, minder verpakkingen of financiële besparing/)
  assert.doesNotMatch(html, /<button|<a\s|€|[0-9][,.][0-9]{2}/)
})

test('actual React card has informative invalid-plan and no-overlap states', async () => {
  const Component = await loadComponent()
  const invalid = renderToStaticMarkup(createElement(Component, { insight: null }))
  assert.match(invalid, /Maak eerst een geldige planning/)
  assert.match(invalid, /role="status"/)
  assert.doesNotMatch(invalid, /<li/)

  const empty = buildIngredientReuseInsight({
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: ['Wo'],
  })
  const html = renderToStaticMarkup(createElement(Component, { insight: empty }))
  assert.match(html, /geen ingrediënten meerdere dagen terug/)
  assert.doesNotMatch(html, /<li/)
})

test('actual React escapes hostile ingredient labels and day text as inert content', async () => {
  const Component = await loadComponent()
  const label = '<img src=x onerror=alert(1)>'
  const insight = {
    activeMealCount: 2,
    distinctIngredientCount: 1,
    reusedIngredients: [{
      ingredientId: 'safe-id',
      label,
      days: ['Ma', '<svg onload=alert(1)>'],
      recipeIds: ['one', 'two'],
      mealCount: 2,
    }],
  }
  const html = renderToStaticMarkup(createElement(Component, { insight }))
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(html, /&lt;svg onload=alert\(1\)&gt;/)
  assert.doesNotMatch(html, /<img|<svg|onerror="/)
})

test('isolated reuse CSS wraps long labels and has no fixed viewport width', async () => {
  const css = await readFile(
    new URL('../src/features/planner/ingredient-reuse.css', import.meta.url),
    'utf8',
  )
  assert.match(css, /\.ingredient-reuse-list li strong,[\s\S]*overflow-wrap:\s*anywhere/)
  assert.match(css, /min-width:\s*0/)
  assert.doesNotMatch(css, /min-width:\s*[1-9][0-9]*px|width:\s*[1-9][0-9]*px/)
})
