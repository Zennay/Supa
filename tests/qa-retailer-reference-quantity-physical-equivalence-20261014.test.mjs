import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

/** Fictional saved Schema.org Product JSON-LD only; NO live retailer requests.
 * Distinguishes a physically EXACT same-pack reference rate from a per-unit
 * reference that covers a different amount than the SKU sold at checkout.
 */
const AT='2026-10-15T09:00:00.000Z'
const NOW=Date.parse('2026-10-15T10:00:00.000Z')
const requirement={id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}
function source(shop){return SOURCES.find(x=>x.id===shop+'-product-halfvolle-melk')}
function observed(shop,offer){
  const html='<script type="application/ld+json">'+JSON.stringify({
    '@context':'https://schema.org','@type':'Product',
    name:'Halfvolle melk',sku:'fictional-1L',
    weight:{value:'1000 ml'},offers:offer,
  })+'</script>'
  const snap=parseOfflineRetailerSnapshot({source:source(shop),html,capturedAt:AT})
  assert.equal(snap.observations.length,1)
  return snap.observations[0]
}
const normalOffer={
  '@type':'Offer',price:'1.29',priceCurrency:'EUR',
  availability:'https://schema.org/InStock',
}
function refOffer(value,unitCode) {
  return {
    '@type':'Offer',availability:'https://schema.org/InStock',
    priceSpecification:{
      '@type':'UnitPriceSpecification',price:'0.85',priceCurrency:'EUR',
      referenceQuantity:{'@type':'QuantitativeValue',value,unitCode},
    },
  }
}
function compare(offer) {
  const plus=observed('plus',normalOffer)
  const deka=observed('dekamarkt',offer)
  return {deka,comparison:compareReviewedCatalogs({
    requirements:[requirement],observations:[plus,deka],nowMs:NOW,
  })}
}
function assertValidReference(offer) {
  const {deka,comparison}=compare(offer)
  assert.equal(deka.currentPriceCents,85,
    'physically identical referenceQuantity/pack size has exact single-pack cents')
  assert.equal(comparison.comparable,true)
  assert.equal(comparison.stores.plus.subtotalCents,258)
  assert.equal(comparison.stores.dekamarkt.subtotalCents,170)
  assert.equal(comparison.cheaperStore,'dekamarkt')
  assert.equal(comparison.savingsCents,88)
  assert.equal(comparison.claimable,false)
}
function assertNoPrice(offer) {
  const {deka,comparison}=compare(offer)
  assert.equal(deka.currentPriceCents,null,
    'referenceQuantity differing from the physical pack cannot set pack price')
  assert.equal(comparison.comparable,false)
  assert.equal(comparison.cheaperStore,null)
  assert.equal(comparison.savingsCents,null)
  assert.equal(comparison.claimable,false)
}
test('concrete Offer.price unchanged: baseline 1L pack remains purchasable at 129 cents',()=>{
  const row=observed('plus',normalOffer)
  assert.equal(row.currentPriceCents,129)
  assert.equal(row.availability,'available')
})
test('physically exact 1000 MLT unit reference for 1000ml pack must remain 85-cent pack',()=>{
  assertValidReference(refOffer('1000','MLT'))
})
test('equivalent 1 LTR for 1000ml pack is physically exact reference quantity',()=>{
  assertValidReference(refOffer(1,'LTR'))
})
test('EXPECTED RED on uncorrected source: 500 MLT reference is not 1000ml pack checkout price',()=>{
  assertNoPrice(refOffer(500,'MLT'))
})
test('EXPECTED RED on uncorrected source: 1 KGM mass reference cannot price 1L milk by volume',()=>{
  assertNoPrice(refOffer(1,'KGM'))
})
test('EXPECTED RED on uncorrected source: 1500 MLT reference cannot price a 1L milk pack',()=>{
  assertNoPrice(refOffer(1500,'MLT'))
})
