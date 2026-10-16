import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prepareUnpricedPrivateRecipe } from '../src/features/user-recipes/reviewedRecipeBasketBridge.ts'
import { createPrivateRecipeWeekPreview } from '../src/features/user-recipes/privateWeekPlanner.ts'
import { PrivateRecipeWeekPlanner } from '../src/features/user-recipes/PrivateRecipeWeekPlanner.ts'

function makeRecipe(name='Broccoli', id='broccoli') {
  const result=prepareUnpricedPrivateRecipe({
    source:'manual',sourceUrl:null,title:name,servings:2,minutes:15,
    status:'needs_review',warnings:[],steps:['Kook'],
    ingredients:[{clientId:'one',original:'200 g broccoli',label:'Broccoli',query:'broccoli',amount:200,unit:'g',reviewReason:null}],
  },id)
  assert.equal(result.status,'unpriced_ready')
  return result.recipe
}

test('one chosen Monday private recipe provides review-only shopping and exact one day',()=>{
  const recipe=makeRecipe()
  const r=createPrivateRecipeWeekPreview([recipe],{Ma:recipe.id,Di:null})
  assert.equal(r.status,'preview_ready')
  assert.deepEqual(r.days,['Ma'])
  assert.deepEqual(r.plan,[{day:'Ma',recipeId:recipe.id}])
  assert.equal(r.preview.savingsVerified,false)
  assert.equal(r.preview.unresolvedItemCount,1)
})

test('repeated private recipe on two days aggregates the quantities by existing basket engine',()=>{
  const recipe=makeRecipe()
  const r=createPrivateRecipeWeekPreview([recipe],{Ma:recipe.id,Do:recipe.id})
  assert.equal(r.status,'preview_ready')
  assert.deepEqual(r.days,['Ma','Do'])
  assert.match(r.preview.copyText,/400/)
})

test('multiple private recipes share ingredient query and get a single shopping item',()=>{
  const a=makeRecipe('Broccoli pasta','pasta'),b=makeRecipe('Broccoli rijst','rijst')
  const r=createPrivateRecipeWeekPreview([a,b],{Wo:a.id,Vr:b.id})
  assert.equal(r.status,'preview_ready')
  assert.equal(r.preview.unresolvedItemCount,1)
  assert.match(r.preview.copyText,/400/)
})

test('no selected recipe shows honest empty selection instead of a completed basket',()=>{
  const recipe=makeRecipe()
  assert.deepEqual(createPrivateRecipeWeekPreview([recipe],{}),
    {status:'review_required',reason:'no_recipes_selected'})
  assert.deepEqual(createPrivateRecipeWeekPreview([recipe],{Ma:null,Di:''}),
    {status:'review_required',reason:'no_recipes_selected'})
})

test('unknown recipe ID, non-week keys and getter properties fail closed',()=>{
  const a=makeRecipe()
  for(const selection of [
    {Ma:'private-recipe:not-found'},
    {Maan:a.id},
    {Ma:a.id,constructor:a.id},
    Object.defineProperty({},'Ma',{enumerable:true,get(){throw new Error('should not run')}}),
  ]) {
    assert.deepEqual(createPrivateRecipeWeekPreview([a],selection),
      {status:'review_required',reason:'invalid_selection'})
  }
})

test('duplicate recipe IDs and invalid container refuse to produce a shopping list',()=>{
  const a=makeRecipe()
  assert.equal(createPrivateRecipeWeekPreview([a,a],{Ma:a.id}).status,'review_required')
  assert.equal(createPrivateRecipeWeekPreview([a],null).status,'review_required')
  assert.equal(createPrivateRecipeWeekPreview([a],['Ma']).status,'review_required')
})

test('controlled seven-day React UI server renders semantic selects and unpriced list',()=>{
  const a=makeRecipe()
  const r=renderToStaticMarkup(createElement(PrivateRecipeWeekPlanner,{
    recipes:[a], selection:{Ma:a.id}, onSelectionChange:()=>{},
  }))
  assert.equal((r.match(/<select/g)||[]).length,7)
  assert.match(r,/Mijn recepten plannen/)
  assert.match(r,/Weekplanning/)
  assert.match(r,/Recept voor Ma/)
  assert.match(r,/Boodschappen uit mijn recepten/)
  assert.match(r,/prijzen zijn nog onbekend/)
  assert.doesNotMatch(r,/€/)
})

test('controlled UI explains no-recipe state and has no list when nothing selected',()=>{
  const a=makeRecipe()
  const r=renderToStaticMarkup(createElement(PrivateRecipeWeekPlanner,{
    recipes:[a],selection:{},onSelectionChange:()=>{},
  }))
  assert.match(r,/Kies ten minste één recept/)
  assert.doesNotMatch(r,/Boodschappen uit mijn recepten/)
})

test('controlled UI escapes malicious recipe title rather than rendering HTML',()=>{
  const a={...makeRecipe(),title:'<script>evil()</script>'}
  const r=renderToStaticMarkup(createElement(PrivateRecipeWeekPlanner,{
    recipes:[a],selection:{Ma:a.id},onSelectionChange:()=>{},
  }))
  assert.ok(r.includes('&lt;script&gt;'))
  assert.ok(!r.includes('<script>'))
})
