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

test('studio refuses own recipe ID getters without executing them or publishing draft',()=>{
  const valid=existing()
  let calls=0
  const forged={...valid}
  Object.defineProperty(forged,'id',{enumerable:true,get(){calls++;return valid.id}})
  const added=[]
  const p=props({recipes:[forged],onAddReviewedRecipe:recipe=>added.push(recipe)})
  const view=PrivateRecipeStudio(p)
  const editor=view.props.children.find(child=>child?.type===MockEditor)
  editor.props.onConfirm(p.draft)
  assert.equal(calls,0)
  assert.deepEqual(added,[])
  assert.equal(view.props.children.find(child=>child?.props?.role==='status')?.props.children.includes('nog niet klaar'),true)
})

test('studio refuses inherited recipe identity accessors without touching them',()=>{
  const valid=existing()
  let calls=0
  const inherited=Object.create({get id(){calls++;return valid.id}})
  const {id: omitted, ...rest}=valid
  Object.assign(inherited,rest)
  const added=[]
  const p=props({recipes:[inherited],onAddReviewedRecipe:recipe=>added.push(recipe)})
  const view=PrivateRecipeStudio(p)
  const editor=view.props.children.find(child=>child?.type===MockEditor)
  editor.props.onConfirm(p.draft)
  assert.equal(calls,0)
  assert.equal(added.length,0)
})

test('invalid or duplicated private library identities never authorize a new local recipe',()=>{
  const valid=existing()
  for(const invalid of [[valid,valid],[{...valid,id:'other:recipe'}],null]) {
    const added=[]
    const p=props({recipes:invalid,onAddReviewedRecipe:recipe=>added.push(recipe)})
    const accept=confirmationCallback(p)
    accept(p.draft)
    assert.equal(added.length,0)
  }
})

test('valid own-ID library preserves event-time confirmation and unknown-price contract',()=>{
  const added=[]
  const p=props({recipes:[existing()],onAddReviewedRecipe:recipe=>added.push(recipe)})
  const accept=confirmationCallback(p)
  accept(p.draft)
  assert.equal(added.length,1)
  assert.equal(added[0].id,'private-recipe:new-one')
  assert.equal(added[0].estimatedCost,null)
  assert.equal(added[0].priceStatus,'unknown')
})

test('sparse or accessor recipe collection slots cannot create local drafts',()=>{
  const added=[]
  const sparse=new Array(1)
  const propertyReads={count:0}
  const accessor=[]
  Object.defineProperty(accessor,0,{enumerable:true,configurable:true,
    get(){propertyReads.count++;return existing()}})
  accessor.length=1
  for (const recipes of [sparse,accessor]) {
    const p=props({recipes,onAddReviewedRecipe:recipe=>added.push(recipe)})
    const accept=confirmationCallback(p)
    accept(p.draft)
  }
  assert.equal(propertyReads.count,0)
  assert.equal(added.length,0)
})

test('revoked recipe library Proxy fails closed before any recipe is added',()=>{
  const revoked=Proxy.revocable([], {})
  revoked.revoke()
  const added=[]
  const p=props({recipes:revoked.proxy,onAddReviewedRecipe:recipe=>added.push(recipe)})
  assert.doesNotThrow(()=>{
    const accept=confirmationCallback(p)
    accept(p.draft)
  })
  assert.equal(added.length,0)
})

test('invalid or missing host week selection renders review only without crash or recipe creation',()=>{
  for(const selectedDays of [null,undefined,{Unknown:'private-recipe:saved-one'}]) {
    const added=[]
    const p=props({selectedDays,onAddReviewedRecipe:recipe=>added.push(recipe)})
    const html=renderToStaticMarkup(createElement(PrivateRecipeStudio,p))
    assert.match(html,/Dit recept is nog niet klaar voor de weekplanner/)
    assert.doesNotMatch(html,/Boodschappen uit mijn recepten/)
    assert.doesNotMatch(html,/€/)
    confirmationCallback(p)(p.draft)
    assert.equal(added.length,0)
  }
})

test('host week selection getter is never invoked when validating studio props',()=>{
  const valid=existing()
  let reads=0
  const selectedDays={}
  Object.defineProperty(selectedDays,'Ma',{enumerable:true,
    get(){reads++;return valid.id}})
  const added=[]
  const p=props({selectedDays,onAddReviewedRecipe:recipe=>added.push(recipe)})
  const html=renderToStaticMarkup(createElement(PrivateRecipeStudio,p))
  assert.equal(reads,0)
  assert.match(html,/nog niet klaar voor de weekplanner/)
  confirmationCallback(p)(p.draft)
  assert.equal(reads,0)
  assert.equal(added.length,0)
})

test('complete studio library snapshot blocks title/ingredients getter and review-list rendering',()=>{
  for (const field of ['title','ingredients']) {
    const valid=existing()
    const mutated={...valid}
    let calls=0
    Object.defineProperty(mutated,field,{
      enumerable:true,configurable:true,
      get(){calls++;return valid[field]},
    })
    const added=[]
    const p=props({recipes:[mutated],onAddReviewedRecipe:r=>added.push(r)})
    const html=renderToStaticMarkup(createElement(PrivateRecipeStudio,p))
    assert.equal(calls,0)
    assert.doesNotMatch(html,/Boodschappen uit mijn recepten/)
    assert.match(html,/Dit recept is nog niet klaar/)
    confirmationCallback(p)(p.draft)
    assert.equal(calls,0)
    assert.equal(added.length,0)
  }
})

test('nested ingredient accessor and sparse nested ingredient arrays fail closed',()=>{
  const good=existing()
  let calls=0
  const ingredient={...good.ingredients[0]}
  Object.defineProperty(ingredient,'amount',{enumerable:true,
    get(){calls++;return 200}})
  const hostile={...good,ingredients:[ingredient]}
  for(const recipes of [[hostile],[{...good,ingredients:new Array(1)}]]) {
    const added=[]
    const p=props({recipes,onAddReviewedRecipe:r=>added.push(r)})
    const html=renderToStaticMarkup(createElement(PrivateRecipeStudio,p))
    assert.doesNotMatch(html,/Boodschappen uit mijn recepten/)
    confirmationCallback(p)(p.draft)
    assert.equal(added.length,0)
  }
  assert.equal(calls,0)
})

test('unknown or foreign selected private recipe ID is review-only, never locally added',()=>{
  for(const id of ['private-recipe:missing','foreign:unreviewed']) {
    const added=[]
    const p=props({selectedDays:{Wo:id},onAddReviewedRecipe:r=>added.push(r)})
    const html=renderToStaticMarkup(createElement(PrivateRecipeStudio,p))
    assert.match(html,/Dit recept is nog niet klaar/)
    assert.doesNotMatch(html,/Boodschappen uit mijn recepten/)
    confirmationCallback(p)(p.draft)
    assert.equal(added.length,0)
  }
})

test('plain owned existing library and valid selected day remain confirmable once',()=>{
  const created=[]
  const p=props({selectedDays:{Ma:'private-recipe:saved-one'},
    onAddReviewedRecipe:r=>created.push(r)})
  const html=renderToStaticMarkup(createElement(PrivateRecipeStudio,p))
  assert.match(html,/Boodschappen uit mijn recepten/)
  const confirm=confirmationCallback(p)
  confirm(p.draft)
  confirm(p.draft)
  assert.equal(created.length,1)
  assert.equal(created[0].estimatedCost,null)
  assert.equal(created[0].priceStatus,'unknown')
})
