import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prepareUnpricedPrivateRecipe } from '../src/features/user-recipes/reviewedRecipeBasketBridge.ts'
import { PrivateRecipeStudio } from '../src/features/user-recipes/PrivateRecipeStudio.ts'

function MockEditor({draft}) {
  return createElement('div', {}, [
    createElement('h3', {key:'header'}, 'Mijn recept controleren'),
    createElement('p', {key:'draft-name'}, draft.title),
  ])
}

function draft(overrides={}) {
  return {
    source:'manual',sourceUrl:null,title:'Gevulde broccoli',servings:2,minutes:20,
    warnings:[],steps:['Bak 10 minuten'],status:'needs_review',
    ingredients:[{clientId:'ing-1',original:'200g broccoli',label:'Broccoli',query:'broccoli',amount:200,unit:'g',reviewReason:null}],
    ...overrides,
  }
}
function existing(){
  const ready=prepareUnpricedPrivateRecipe(draft(),'saved-one')
  assert.equal(ready.status,'unpriced_ready')
  return ready.recipe
}
function props(overrides={}){
  return {
    EditorComponent:MockEditor,draft:draft(),draftLocalId:'new-one',recipes:[existing()],selectedDays:{Ma:'private-recipe:saved-one'},
    onDraftChange:()=>{},onAddReviewedRecipe:()=>{},onSelectedDaysChange:()=>{},onCancelDraft:()=>{},
    ...overrides,
  }
}
function confirmationCallback(parameters){
  const outer=PrivateRecipeStudio(parameters)
  const editor=outer.props.children.find((child)=>child?.type===MockEditor)
  assert.ok(editor)
  return editor.props.onConfirm
}

test('full product studio composes actual controlled editor and one-week copyable list',()=>{
  const html=renderToStaticMarkup(createElement(PrivateRecipeStudio,props()))
  assert.match(html,/Mijn recepten maken en plannen/)
  assert.match(html,/Mijn recept controleren/)
  assert.match(html,/Mijn recepten plannen/)
  assert.match(html,/Boodschappen uit mijn recepten/)
  assert.match(html,/Kopieerbare boodschappenlijst/)
  assert.match(html,/er wordt niets online opgeslagen/)
  assert.doesNotMatch(html,/€/)
})

test('real onConfirm handler emits only reviewed, unpriced private recipe once',()=>{
  const added=[]
  const p=props({onAddReviewedRecipe:(r)=>added.push(r)})
  const accept=confirmationCallback(p)
  accept(p.draft)
  assert.equal(added.length,1)
  assert.equal(added[0].id,'private-recipe:new-one')
  assert.equal(added[0].estimatedCost,null)
  assert.equal(added[0].priceStatus,'unknown')
})

test('event-time invalid or unknown amount cannot enter local library',()=>{
  const added=[]
  const p=props({onAddReviewedRecipe:(r)=>added.push(r)})
  const accept=confirmationCallback(p)
  const malformed=draft()
  malformed.ingredients[0].amount=null
  malformed.ingredients[0].reviewReason='onbekend'
  accept(malformed)
  assert.equal(added.length,0)
})

test('event-time URL importer remains blocked despite complete metric fields',()=>{
  const added=[]
  const p=props({onAddReviewedRecipe:(r)=>added.push(r)})
  const accept=confirmationCallback(p)
  accept(draft({source:'url',sourceUrl:'https://example.org/recipe'}))
  assert.equal(added.length,0)
})

test('existing recipe identities may not be silently overwritten',()=>{
  const added=[]
  const p=props({draftLocalId:'saved-one',onAddReviewedRecipe:(r)=>added.push(r)})
  confirmationCallback(p)(p.draft)
  assert.equal(added.length,0)
})

test('no caller draft mutation and no implicit device/account storage',()=>{
  const src=draft()
  Object.freeze(src.ingredients[0])
  Object.freeze(src.ingredients)
  Object.freeze(src.steps)
  Object.freeze(src.warnings)
  Object.freeze(src)
  const p=props({draft:src})
  const added=[]
  confirmationCallback({...p,onAddReviewedRecipe:(r)=>added.push(r)})(src)
  assert.equal(added.length,1)
  assert.notEqual(added[0].ingredients,src.ingredients)
  assert.ok(!('sourceUrl' in added[0]))
})

test('rendered unsafe-looking recipe title is escaped by React',()=>{
  const malicious=draft({title:'<script>hello()</script>'})
  const html=renderToStaticMarkup(createElement(PrivateRecipeStudio,props({draft:malicious})))
  assert.doesNotMatch(html,/<script>/)
  assert.match(html,/&lt;script&gt;/)
})

test('incomplete recipe visible as review required and never fake-saved',()=>{
  const html=renderToStaticMarkup(createElement(PrivateRecipeStudio,props({draft:draft({minutes:null})})))
  assert.match(html,/nog niet klaar voor de weekplanner/)
  assert.match(html,/Controleer herkomst/)
  assert.doesNotMatch(html,/€/)
})

test('same rendered studio cannot enqueue duplicate private recipe on rapid confirmation',()=>{
  const added=[]
  const p=props({recipes:[],onAddReviewedRecipe:recipe=>added.push(recipe)})
  const accept=confirmationCallback(p)
  accept(p.draft)
  accept(p.draft)
  assert.equal(added.length,1)
  assert.equal(added[0].id,'private-recipe:new-one')
  assert.equal(added[0].estimatedCost,null)
})

test('rejected invalid draft does not reserve ID against subsequent valid confirmation',()=>{
  const added=[]
  const p=props({recipes:[],onAddReviewedRecipe:recipe=>added.push(recipe)})
  const accept=confirmationCallback(p)
  accept(draft({minutes:null}))
  accept(p.draft)
  accept(p.draft)
  assert.equal(added.length,1)
  assert.equal(added[0].priceStatus,'unknown')
})

test('same-render at-most-once delivery remains safe if parent callback throws',()=>{
  const p=props({recipes:[],onAddReviewedRecipe:()=>{throw new Error('parent rejected')}})
  const accept=confirmationCallback(p)
  assert.throws(()=>accept(p.draft),/parent rejected/)
  assert.doesNotThrow(()=>accept(p.draft))
})
