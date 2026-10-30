import test from 'node:test'
import assert from 'node:assert/strict'
import {scanOfflineRetailerMarkup} from '../scripts/retailer-offline-structural-scan.mjs'

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
