/**
 * Independent QA against immutable product studio #3347
 * 368831fe28d20684416f3971e4d00ce429304fed.
 * Having an own-data recipe ID is not sufficient if other private library
 * fields can execute caller-controlled accessors during React rendering.
 * Only fictional in-memory recipes and React SSR; no network, browser, store.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PrivateRecipeStudio } from '../src/features/user-recipes/PrivateRecipeStudio.ts'
import { prepareUnpricedPrivateRecipe } from '../src/features/user-recipes/reviewedRecipeBasketBridge.ts'

function EditorStub() { return createElement('p', {}, 'Privé redacteur') }
function rawDraft() {
  return {
    source: 'manual', sourceUrl: null, title: 'Fictieve linzenschotel',
    status: 'needs_review', servings: 2, minutes: 20, warnings: [],
    steps: ['Kook de linzen'], ingredients: [{
      clientId: 'fake-1', original: '200 g linzen', label: 'Linzen',
      query: 'linzen', amount: 200, unit: 'g', reviewReason: null,
    }],
  }
}
function trusted() {
  const v = prepareUnpricedPrivateRecipe(rawDraft(), 'existing')
  assert.equal(v.status, 'unpriced_ready')
  return v.recipe
}
function invoke(recipes) {
  const created = []
  const props = {
    EditorComponent: EditorStub, draft: rawDraft(), draftLocalId: 'pending',
    recipes, selectedDays: { Ma: 'private-recipe:existing' },
    onDraftChange() {}, onCancelDraft() {}, onSelectedDaysChange() {},
    onAddReviewedRecipe(r) { created.push(r) },
  }
  const html = renderToStaticMarkup(createElement(PrivateRecipeStudio, props))
  const element = PrivateRecipeStudio(props)
  const injected = element.props.children.find(x => x?.type === EditorStub)
  assert.ok(injected)
  injected.props.onConfirm(props.draft)
  return { html, created }
}

test('positive: genuine own-data private library renders unpriced review checklist and accepts distinct new recipe', () => {
  const result = invoke([trusted()])
  assert.match(result.html, /Boodschappen uit mijn recepten/)
  assert.equal(result.created.length, 1)
  assert.equal(result.created[0].id, 'private-recipe:pending')
  assert.equal(result.created[0].estimatedCost, null)
})

for (const field of ['title', 'ingredients']) {
  test('non-ID private library ' + field + ' accessor must not execute or authorize studio [EXPECTED RED]', () => {
    const original = trusted()
    const entry = { ...original }
    let calls = 0
    Object.defineProperty(entry, field, {
      enumerable: true, configurable: true,
      get() { calls++; return original[field] },
    })
    const result = invoke([entry])
    assert.equal(calls, 0,
      'untrusted library data accessor must not run during React admission/rendering')
    assert.doesNotMatch(result.html, /Boodschappen uit mijn recepten/,
      'host review should not emit a plausible shopping list from accessor-bearing records')
    assert.equal(result.created.length, 0,
      'studio may not admit local recipes against unverifiable host library facts')
  })
}
