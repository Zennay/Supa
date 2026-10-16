import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { prepareUnpricedPrivateRecipe } from '../src/features/user-recipes/reviewedRecipeBasketBridge.ts'
import { prepareUnpricedShoppingPreview } from '../src/features/user-recipes/unpricedShoppingPreview.ts'
import { UnpricedPrivateShoppingPreviewView } from '../src/features/user-recipes/UnpricedPrivateShoppingPreviewView.ts'

function valid() {
  const draft={
    source:'manual',sourceUrl:null,title:'Broccolirijst',servings:2,minutes:20,
    status:'needs_review',steps:[],warnings:[],
    ingredients:[{
      clientId:'one',original:'200g broccoli',label:'Broccoli',query:'broccoli',
      amount:200,unit:'g',reviewReason:null,
    }],
  }
  const built=prepareUnpricedPrivateRecipe(draft,'preview')
  assert.equal(built.status,'unpriced_ready')
  return prepareUnpricedShoppingPreview(
    [{day:'Ma',recipeId:built.recipe.id}],[built.recipe],['Ma'])
}

test('real offline JSX-free React server render exposes review list and accessible label',()=>{
  const preview=valid()
  assert.equal(preview.status,'manual_review_only')
  const html=renderToStaticMarkup(createElement(UnpricedPrivateShoppingPreviewView,{preview}))
  assert.match(html,/Boodschappen uit mijn recepten/)
  assert.match(html,/Kopieerbare boodschappenlijst/)
  assert.match(html,/Broccoli/i)
  assert.match(html,/Zelf product kiezen/i)
  assert.match(html,/aria-describedby/)
  assert.match(html,/readonly/i)
})

test('rendered private list never claims store price or savings',()=>{
  const html=renderToStaticMarkup(createElement(UnpricedPrivateShoppingPreviewView,{preview:valid()}))
  assert.match(html,/Winkel en prijzen zijn nog onbekend/)
  assert.match(html,/Er is geen besparing berekend/)
  assert.ok(!html.includes('€'))
  assert.ok(!html.includes('http'))
})

test('invalid plans render human-safe unavailable state, no empty completed list',()=>{
  const html=renderToStaticMarkup(createElement(UnpricedPrivateShoppingPreviewView,{
    preview:{status:'unavailable',reason:'invalid_or_incomplete_plan'},
  }))
  assert.match(html,/kan nog niet worden gemaakt/)
  assert.ok(!html.includes('<ol'))
  assert.match(html,/role="status"/)
})

test('React rendering escapes hostile-looking ingredient text',()=>{
  const preview=valid()
  assert.equal(preview.status,'manual_review_only')
  preview.checklist.lines[0].label='<script>alert(1)</script>'
  const html=renderToStaticMarkup(createElement(UnpricedPrivateShoppingPreviewView,{preview}))
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;'))
})
