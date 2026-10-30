import test from 'node:test'
import assert from 'node:assert/strict'
import {scanOfflineRetailerMarkup} from '../scripts/retailer-offline-structural-scan.mjs'
import {compareOfflineSelectorProposals} from '../scripts/retailer-private-selector-drift.mjs'
import {proposeOfflineRetailerSelectors,summarizeOfflineSelectorProposals} from '../scripts/retailer-offline-selector-discovery.mjs'

const capture = json => '<html><head><script type="application/ld+json">'+
  JSON.stringify(json)+'</script></head><body><article class="product-card"></article></body></html>'

for(const context of ['https://schema.org','https://schema.org/',
    {'@vocab':'https://schema.org/'}]) {
  test('accepts an official Schema.org Product context '+JSON.stringify(context),()=>{
    const found=scanOfflineRetailerMarkup(capture({'@context':context,'@type':'Product'}))
    assert.equal(found.structuredSignals.jsonLd,true)
    assert.equal(found.structuredSignals.schemaOrgProduct,true)
  })
}
for(const context of ['https://foreign.invalid/',
    {'@vocab':'https://foreign.invalid/'},
    ['https://schema.org/','https://foreign.invalid/'],
    {'@vocab':'https://schema.org/','Product':'https://foreign.invalid/Product'},null,{}]) {
  test('refuses foreign or ambiguous Product contexts '+JSON.stringify(context),()=>{
    const found=scanOfflineRetailerMarkup(capture({'@context':context,'@type':'Product'}))
    assert.equal(found.structuredSignals.jsonLd,true)
    assert.equal(found.structuredSignals.schemaOrgProduct,false)
  })
}
test('foreign parent context does not establish Schema.org graph children',()=>{
  const found=scanOfflineRetailerMarkup(capture({'@context':'https://foreign.invalid/',
    '@graph':[{'@type':'Product'}]}))
  assert.equal(found.structuredSignals.schemaOrgProduct,false)
})
test('official Schema.org graph still provides a nested Product signal',()=>{
  const found=scanOfflineRetailerMarkup(capture({'@context':'https://schema.org/',
    '@graph':[{'@type':'Product'}]}))
  assert.equal(found.structuredSignals.schemaOrgProduct,true)
})

test('Schema.org ItemList ListItem.item detects actual nested catalog products',()=>{
  const html=capture({'@context':'https://schema.org/',
    '@type':'ItemList',itemListElement:[{'@type':'ListItem',position:1,
      item:{'@type':'Product',name:'SYNTHETIC ITEM'}}]})
  const found=scanOfflineRetailerMarkup(html)
  assert.equal(found.structuredSignals.jsonLd,true)
  assert.equal(found.structuredSignals.schemaOrgProduct,true)
  assert.doesNotMatch(found.visible,/SYNTHETIC ITEM/)
})
test('foreign nested ListItem.item type never promotes a product signal',()=>{
  const html=capture({'@context':'https://schema.org/',
    '@type':'ItemList',itemListElement:[{'@type':'ListItem',position:1,
      item:{'@context':'https://foreign.invalid/','@type':'Product'}}]})
  assert.equal(scanOfflineRetailerMarkup(html).structuredSignals.schemaOrgProduct,false)
})

test('observed live Schema.org Product microdata supplies a non-JSON-LD product hint',()=>{
  const html='<article itemscope itemtype="https://schema.org/Product">'+
    '<span itemprop="name">SYNTHETIC PRODUCT</span></article>'
  const report=scanOfflineRetailerMarkup(html)
  assert.equal(report.structuredSignals.schemaOrgProduct,true)
  assert.equal(report.structuredSignals.jsonLd,false)
})
for(const html of [
  '<article itemtype="https://schema.org/Product">Mock</article>',
  '<article itemscope itemtype="https://foreign.invalid/Product">Mock</article>',
  '<article itemscope itemtype="https://schema.org/Product https://foreign.invalid/Product">Mock</article>',
  '<template><article itemscope itemtype="https://schema.org/Product">Hidden</article></template>'
]) {
  test('untrusted or inert Product microdata cannot claim official structure '+html.slice(0,40),()=>{
    const report=scanOfflineRetailerMarkup(html)
    assert.equal(report.structuredSignals.schemaOrgProduct,false)
  })
}

test('observed retailer microdata reaches private selector proposal without price approval',()=>{
  const html='<html><body><article class="product-card" itemscope '+
    'itemtype="https://schema.org/Product"><span itemprop="name">SYNTHETIC</span>'+
    '</article></body></html>'
  const report=proposeOfflineRetailerSelectors({html,origin:{
    retailerId:'plus',url:'https://www.plus.nl/producten',
    capturedAt:'2026-10-14T12:00:00.000Z'}})
  assert.equal(report.structuredSignals.schemaOrgProduct,true)
  assert.equal(report.structuredSignals.jsonLd,false)
  assert.equal(report.readyForIngestion,false)
  assert.equal(report.permissionVerified,false)
  assert.equal(report.productionEnabled,false)
  assert.equal(report.publicSavingsClaimEligible,false)
})

test('source-observed retail microdata creates a reviewable product container selector',()=>{
  for(const [retailerId,host,type] of [
    ['plus','www.plus.nl','https://schema.org/Product'],
    ['dekamarkt','www.dekamarkt.nl','http://schema.org/Product']]) {
    const html='<html><body><article itemscope itemtype="'+type+'">'+
      '<span itemprop="name">SECRET PRIVATE PRODUCT</span>'+
      '</article></body></html>'
    const report=proposeOfflineRetailerSelectors({html,origin:{
      retailerId,url:'https://'+host+'/producten',
      capturedAt:'2026-10-14T12:00:00.000Z'}})
    const selector='article[itemtype="'+type+'"]'
    assert.ok(report.selectors.some(x=>x.field==='product'&&x.selector===selector))
    const safe=summarizeOfflineSelectorProposals(report)
    assert.ok(safe.selectors.some(x=>x.field==='product'&&x.selector===selector))
    assert.equal(report.productionEnabled,false)
    assert.equal(report.readyForIngestion,false)
    assert.doesNotMatch(JSON.stringify(safe),/SECRET PRIVATE PRODUCT/)
  }
})
test('never invents product-container selectors from missing, mixed or inert microdata',()=>{
  const snippets=[
    '<article itemtype="https://schema.org/Product"></article>',
    '<article itemscope itemtype="https://other.invalid/Product"></article>',
    '<article itemscope itemtype="https://schema.org/Product https://other.invalid/Thing"></article>',
    '<template><article itemscope itemtype="https://schema.org/Product"></article></template>',
  ]
  for(const markup of snippets) {
    const report=proposeOfflineRetailerSelectors({html:'<html><body>'+markup+'</body></html>',
      origin:{retailerId:'plus',url:'https://www.plus.nl/producten',
        capturedAt:'2026-10-14T12:00:00.000Z'}})
    assert.ok(!report.selectors.some(row=>row.field==='product'&&row.selector.includes('itemtype')))
  }
})

test('review-only selector drift compares observed product microdata without promoting it',()=>{
  const oldHtml='<html><body><article class="product-card"></article></body></html>'
  const newHtml='<html><body><article itemscope itemtype="https://schema.org/Product">'+
    '<span itemprop="name">PRIVATE NAME</span></article></body></html>'
  const origin={retailerId:'plus',url:'https://www.plus.nl/producten',
    capturedAt:'2026-10-14T12:00:00.000Z'}
  const before=proposeOfflineRetailerSelectors({html:oldHtml,origin})
  const after=proposeOfflineRetailerSelectors({html:newHtml,origin:{
    ...origin,capturedAt:'2026-10-15T12:00:00.000Z'}})
  const change=compareOfflineSelectorProposals(before,after)
  assert.equal(change.newSelectorCandidates>0,true)
  assert.equal(change.perField.product.new>0,true)
  assert.equal(change.automatedSelectorPromotion,false)
  assert.equal(change.productionEnabled,false)
  assert.doesNotMatch(JSON.stringify(change),/PRIVATE NAME|https:\/\/schema.org/)
})
