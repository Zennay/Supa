import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

import { previewRecipeReuseChange } from '../src/domain/ingredientReusePreview.ts'
import { m2InitialPlan, m2Recipes, m2DefaultActiveDays } from '../src/data/m2Fixture.ts'

const require = createRequire(import.meta.url)

async function renderPreview(preview) {
  const source = await readFile(
    new URL('../src/features/planner/IngredientReusePreviewCard.tsx', import.meta.url),
    'utf8',
  )
  const withoutCss = source.replace(/^import '\.\/ingredient-reuse-preview\.css'\s*$/m, '')
  const compiled = ts.transpileModule(withoutCss, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(require, module, module.exports)
  return renderToStaticMarkup(createElement(module.exports.IngredientReusePreviewCard, { preview }))
}

test('real React SSR explains new, lost and changed ingredient overlap without prices', async () => {
  const preview = previewRecipeReuseChange({
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    day: 'Do',
    recipeId: 'pasta',
  })
  assert.ok(preview)
  const html = await renderPreview(preview)
  assert.match(html, /role="status"/)
  assert.match(html, /aria-live="polite"/)
  assert.match(html, /Nieuw gedeeld/)
  assert.match(html, /Niet langer gedeeld/)
  assert.match(html, /Anders verdeeld/)
  assert.match(html, /Griekse yoghurt/)
  assert.match(html, /Kippendij/)
  assert.match(html, /Basmati rijst/)
  assert.match(html, /Niet meer gedeeld tussen gekozen maaltijden/)
  assert.match(html, /Het gerecht wordt niet automatisch gewijzigd/)
  assert.match(html, /Gedeelde ingrediënten bewijzen geen/)
  assert.doesNotMatch(html, /<button|<a\s|€|[0-9][,.][0-9]{2}/)
})

test('actual React SSR distinguishes invalid and identical recipe choices', async () => {
  const invalid = await renderPreview(null)
  assert.match(invalid, /Controleer eerst je planning/)
  assert.doesNotMatch(invalid, /<li/)

  const same = await renderPreview(previewRecipeReuseChange({
    plan: m2InitialPlan,
    recipes: m2Recipes,
    activeDays: m2DefaultActiveDays,
    day: 'Do',
    recipeId: 'tikka',
  }))
  assert.match(same, /Geen verandering in gedeelde ingrediënten/)
  assert.doesNotMatch(same, /<li/)
})

test('actual React SSR escapes hostile ingredient labels and days as text', async () => {
  const label = '<svg onload=alert(1)>'
  const preview = {
    day: 'Do',
    previousRecipeId: 'a',
    nextRecipeId: 'b',
    beforeSharedCount: 0,
    afterSharedCount: 1,
    newlyShared: [{
      ingredientId: 'safe-id',
      label,
      beforeSharedMealCount: null,
      afterSharedMealCount: 2,
      beforeDays: [],
      afterDays: ['Ma', '<img src=x onerror=alert(1)>'],
    }],
    noLongerShared: [],
    changedShared: [],
  }
  const html = await renderPreview(preview)
  assert.match(html, /&lt;svg onload=alert\(1\)&gt;/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.doesNotMatch(html, /<img|<svg|onerror="/)
})

test('preview mobile CSS wraps labels and never forces a fixed content width', async () => {
  const css = await readFile(
    new URL('../src/features/planner/ingredient-reuse-preview.css', import.meta.url),
    'utf8',
  )
  assert.match(css, /\.ingredient-reuse-preview-group li strong,[\s\S]*overflow-wrap:\s*anywhere/)
  assert.match(css, /min-width:\s*0/)
  assert.doesNotMatch(css, /min-width:\s*[1-9][0-9]*px|width:\s*[1-9][0-9]*px/)
})
