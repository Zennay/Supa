import assert from 'node:assert/strict'
import test from 'node:test'
import { proposeOfflineRetailerSelectors } from '../scripts/retailer-offline-selector-discovery.mjs'
import { readAuthorizedHtmlScriptEvidence } from '../scripts/retailer-approved-html-script-evidence.mjs'

const sources = [
  {retailerId:'plus',url:'https://www.plus.nl/product/synthetic-browser-head'},
  {retailerId:'dekamarkt',url:'https://www.dekamarkt.nl/producten/synthetic-browser-head'},
]
const ld = JSON.stringify({'@context':'https://schema.org','@type':'Product',name:'SYNTHETIC',offers:{'@type':'Offer',price:'1.99',priceCurrency:'EUR'}})
const observed = '<article class="product-card"><span class="price_value">SYNTHETIC_PRICE</span></article>'
const begin = '<!doctype html><html><head><meta charset="utf-8"><script type="application/ld+json">' + ld + '</script>'
for(const source of sources){
  const origin={...source,capturedAt:'2026-10-29T15:00:00Z'}
  test(`${source.retailerId}: omitted head/body boundaries preserve observed price and product script`,()=>{
    for(const opener of ['<main>','<section>','<div>','<custom-product-card>']){
      const html=begin+opener+observed
      const review=proposeOfflineRetailerSelectors({html,origin})
      assert.ok(review.selectors.some(x=>x.field==='price'&&x.selector==='span.price_value'),opener)
      assert.equal(review.structuredSignals.schemaOrgProduct,true)
      const scripts=readAuthorizedHtmlScriptEvidence(html,source.url)
      assert.equal(scripts.invalid,false,opener)
      assert.equal(scripts.jsonLdBlocks.length,1)
      assert.equal(scripts.verifiedSchemaProductContexts,true)
    }
  })
  test(`${source.retailerId}: inert template CSS stays hidden and head noarchive still denies`,()=>{
    const html=begin+'<template><main><span class="price_value">SYNTHETIC_INERT</span></main></template>'+ '<main><span class="name_value">SYNTHETIC_NAME</span>'
    const review=proposeOfflineRetailerSelectors({html,origin})
    assert.equal(review.selectors.some(x=>x.field==='price'),false)
    assert.ok(review.selectors.some(x=>x.field==='name'))
    assert.equal(readAuthorizedHtmlScriptEvidence(html,source.url).invalid,false)
    const denied=begin+'<meta name="robots" content="noarchive"><main>'+observed
    assert.equal(readAuthorizedHtmlScriptEvidence(denied,source.url).invalid,true)
    assert.throws(()=>proposeOfflineRetailerSelectors({html:denied,origin}),/archive|retention/i)
  })
}
