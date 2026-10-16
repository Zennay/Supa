import test from 'node:test'
import assert from 'node:assert/strict'
import { readRecipeLibrary, saveRecipeLibrary, reviewRecipe } from '../src/features/recipes/recipeLibrary.ts'
import { createManualRecipeDraft, importRecipeFromHtml } from '../src/domain/userRecipeImport.ts'

function storage(initial = null) { let raw = initial; return { getItem: () => raw, setItem: (_key, next) => { raw = next } } }
const recipe = () => ({ ...reviewRecipe(createManualRecipeDraft({ title: 'Mijn curry', servings: 2, minutes: 20, ingredients: ['0,5 kg rijst', '200 ml kokosmelk'], steps: ['Kook de rijst.'] })), id: 'own-test', savedAt: '2026-10-16T15:00:00Z' })
test('manual recipe survives reload with canonical metric fields and original text', () => {
  const s = storage(); saveRecipeLibrary(s, readRecipeLibrary(s), [recipe()])
  const restored = readRecipeLibrary(s)
  assert.equal(restored.recipes[0].ingredients[0].amount, 500)
  assert.equal(restored.recipes[0].ingredients[0].unit, 'g')
  assert.equal(restored.recipes[0].ingredients[0].original, '0,5 kg rijst')
  assert.equal(restored.recipes[0].title, 'Mijn curry')
  assert.equal(restored.error, null)
})
test('malformed/future library is never overwritten', () => {
  for (const raw of ['{broken', '{"version":2,"recipes":[]}', '{"version":1,"recipes":[{}]}']) {
    const s = storage(raw); const state = readRecipeLibrary(s)
    assert.ok(state.error); assert.throws(() => saveRecipeLibrary(s, state, [recipe()]))
    assert.equal(s.getItem(), raw)
  }
})
test('another tab edit and quota failure keep old data', () => {
  const s = storage(); const state = readRecipeLibrary(s)
  s.setItem('', 'other-tab'); assert.throws(() => saveRecipeLibrary(s, state, [recipe()]), /ander tabblad/)
  assert.equal(s.getItem(), 'other-tab')
  assert.throws(() => saveRecipeLibrary({ getItem: () => null, setItem() { throw new Error('quota') } }, { raw: null, recipes: [], error: null }, [recipe()]), /quota/)
})
test('URL and manual recipes share storage shape without invented prices', () => {
  const draft = importRecipeFromHtml('<script type="application/ld+json">'+JSON.stringify({ '@type':'Recipe', name:'Pasta', recipeYield:'2 personen', totalTime:'PT20M', recipeIngredient:['200 g pasta','zout naar smaak'], recipeInstructions:[{ '@type':'HowToStep', text:'Kook de pasta.' }] })+'</script>', 'https://recipes.example.org/pasta')
  const s = storage(); saveRecipeLibrary(s, readRecipeLibrary(s), [{ ...reviewRecipe(draft), id:'own-url', savedAt:'2026-10-16T15:00:00Z' }])
  const saved = readRecipeLibrary(s).recipes[0]
  assert.equal(saved.sourceUrl, 'https://recipes.example.org/pasta'); assert.equal(saved.ingredients[1].amount, null)
  assert.ok(saved.warnings.length); assert.equal(Object.hasOwn(saved,'price'), false); assert.deepEqual(saved.steps, ['Kook de pasta.'])
})
