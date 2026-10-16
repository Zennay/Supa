import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareUnpricedPrivateRecipe } from '../src/features/user-recipes/reviewedRecipeBasketBridge.ts'
import { prepareUnpricedShoppingPreview } from '../src/features/user-recipes/unpricedShoppingPreview.ts'

function draft() {
  return {
    source:'manual',sourceUrl:null,title:'Rijst broccoli',servings:2,minutes:15,
    steps:['Roerbak'],warnings:[],status:'needs_review',
    ingredients:[
      {clientId:'rice',original:'150 g rijst',label:'Basmati rijst',query:'basmati rijst',amount:150,unit:'g',reviewReason:null},
      {clientId:'broc',original:'200 g broccoli',label:'Broccoli',query:'broccoli',amount:200,unit:'g',reviewReason:null},
    ],
  }
}
function ready(id) {
  const result=prepareUnpricedPrivateRecipe(draft(),id)
  assert.equal(result.status,'unpriced_ready')
  return result.recipe
}

test('real offline recipe -> basket -> printable review-only shopping list and copy text', () => {
  const recipe=ready('one')
  const p=prepareUnpricedShoppingPreview([{day:'Ma',recipeId:recipe.id}],[recipe],['Ma'])
  assert.equal(p.status,'manual_review_only')
  assert.equal(p.retailerPricesKnown,false)
  assert.equal(p.savingsVerified,false)
  assert.equal(p.unresolvedItemCount,2)
  assert.equal(p.checklist.reviewCount,2)
  assert.equal(p.checklist.lines.length,2)
  assert.ok(p.checklist.lines.every((l)=>l.needsReview))
  assert.match(p.copyText,/Boodschappenlijst/)
  assert.match(p.copyText,/product zelf kiezen/)
})

test('two days use real basket aggregator, not double-printed separate copies', () => {
  const recipe=ready('repeat')
  const p=prepareUnpricedShoppingPreview(
    [{day:'Ma',recipeId:recipe.id},{day:'Di',recipeId:recipe.id}],
    [recipe],['Ma','Di'])
  assert.equal(p.status,'manual_review_only')
  assert.equal(p.checklist.lines.length,2)
  assert.ok(p.checklist.lines.some(x=>x.quantity.includes('300')))
  assert.ok(p.checklist.lines.some(x=>x.quantity.includes('400')))
})

test('different private recipes sharing query and unit aggregate through canonical basket', () => {
  const a=ready('one'), b=ready('two')
  const p=prepareUnpricedShoppingPreview(
    [{day:'Ma',recipeId:a.id},{day:'Di',recipeId:b.id}],
    [a,b],['Ma','Di'])
  assert.equal(p.status,'manual_review_only')
  assert.equal(p.unresolvedItemCount,2)
})

test('no user source links, prices, fake savings or EURI appear in copied list', () => {
  const recipe=ready('privacy')
  const p=prepareUnpricedShoppingPreview([{day:'Ma',recipeId:recipe.id}],[recipe],['Ma'])
  assert.equal(p.status,'manual_review_only')
  assert.ok(!p.copyText.includes('http'))
  assert.ok(!p.copyText.includes('€'))
  assert.ok(!p.copyText.toLowerCase().includes('besparing'))
  assert.equal(p.checklist.isDemo,false)
  assert.equal(p.checklist.storeLabel,'Winkel nog te kiezen')
})

test('no zero-item plan is advertised as an empty completed shop', () => {
  const recipe=ready('empty')
  assert.equal(prepareUnpricedShoppingPreview([], [recipe], []).status,'unavailable')
  assert.equal(prepareUnpricedShoppingPreview([{day:'Ma',recipeId:recipe.id}],[recipe],[]).status,'unavailable')
})

test('missing, duplicate and ambiguous plans are rejected without copied partial lists', () => {
  const recipe=ready('valid')
  const duplicate=prepareUnpricedShoppingPreview([{day:'Ma',recipeId:recipe.id}], [recipe,recipe],['Ma'])
  assert.equal(duplicate.status,'unavailable')
  const missing=prepareUnpricedShoppingPreview([{day:'Ma',recipeId:'private-recipe:missing'}], [recipe],['Ma'])
  assert.equal(missing.status,'unavailable')
  const duplicateDay=prepareUnpricedShoppingPreview(
    [{day:'Ma',recipeId:recipe.id},{day:'Ma',recipeId:recipe.id}],
    [recipe],['Ma'])
  assert.equal(duplicateDay.status,'unavailable')
})

test('caller attempts to insert a priced or unauthorised recipe cannot get preview', () => {
  const recipe=ready('trusted')
  assert.equal(prepareUnpricedShoppingPreview(
    [{day:'Ma',recipeId:recipe.id}], [{...recipe,estimatedCost:0}], ['Ma']).status,'unavailable')
  assert.equal(prepareUnpricedShoppingPreview(
    [{day:'Ma',recipeId:recipe.id}], [{...recipe,provenance:'url_import'}], ['Ma']).status,'unavailable')
})

test('input may be deeply frozen: no plan, draft or ingredient mutation', () => {
  const recipe=ready('frozen')
  for(const r of recipe.ingredients) Object.freeze(r)
  Object.freeze(recipe.ingredients)
  Object.freeze(recipe.tags)
  Object.freeze(recipe)
  const plan=Object.freeze([{day:'Ma',recipeId:recipe.id}].map(x=>Object.freeze(x)))
  const recipes=Object.freeze([recipe])
  const active=Object.freeze(['Ma'])
  const p=prepareUnpricedShoppingPreview(plan,recipes,active)
  assert.equal(p.status,'manual_review_only')
  assert.equal(recipe.estimatedCost,null)
})

test('strictly no live catalogue call or authenticated persistence exists in the preview', () => {
  const recipe=ready('plain')
  const p=prepareUnpricedShoppingPreview([{day:'Ma',recipeId:recipe.id}],[recipe],['Ma'])
  assert.equal(p.status,'manual_review_only')
  assert.ok(!('basket' in p))
  assert.ok(!('totalCents' in p))
  assert.ok(!('userId' in p))
  assert.ok(!('products' in p))
})
