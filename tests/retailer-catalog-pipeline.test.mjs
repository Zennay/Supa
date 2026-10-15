import test from 'node:test'
import assert from 'node:assert/strict'
import { compareReviewedCatalogs } from '../src/domain/reviewedCatalogComparison.ts'
import { parseOfflineRetailerSnapshot } from '../scripts/retailer-snapshot-adapters.mjs'
import { fetchAuthorizedRetailerHtml } from '../scripts/retailer-authorized-fetch.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

const now = Date.parse('2026-10-15T10:00:00Z')
const source = (supermarket) => ({
  supermarket, kind: 'product',
  url: supermarket === 'plus' ? SOURCES[0].url : SOURCES[3].url,
  capturedAt: '2026-10-15T09:00:00Z', sha256: 'a'.repeat(64),
})
const product = (shop, cents, overrides = {}) => ({
  supermarket: shop, sourceProductId: 'milk-1', name: 'Halfvolle melk',
  currentPriceCents: cents, currency: 'EUR',
  pack: { amount: 1000, unit: 'ml', rawText: '1 l' },
  offer: null, availability: 'available', provenance: source(shop), ...overrides,
})
const reqs = [{ id:'milk', query:'halfvolle melk', amount: 1500, unit:'ml' }]

test('same demand uses two whole packs and preserves per-line prices without public claim', () => {
  const result = compareReviewedCatalogs({
    requirements:reqs,
    observations:[product('plus',129),product('dekamarkt',119)],
    nowMs:now,
  })
  assert.equal(result.comparable,true)
  assert.equal(result.claimable,false)
  assert.equal(result.provenance,'offline-snapshot-preview')
  assert.equal(result.lines[0].plus.packs,2)
  assert.equal(result.lines[0].plus.totalCents,258)
  assert.equal(result.lines[0].dekamarkt.totalCents,238)
  assert.equal(result.lines[0].differenceCents,-20)
  assert.equal(result.cheaperStore,'dekamarkt')
  assert.equal(result.savingsCents,20)
})

test('missing and stale product never create a fictitious winner', () => {
  const missing = compareReviewedCatalogs({
    requirements:reqs,observations:[product('plus',129)],nowMs:now,
  })
  assert.equal(missing.comparable,false)
  assert.equal(missing.cheaperStore,null)
  assert.equal(missing.lines[0].dekamarkt.totalCents,null)
  const stale = compareReviewedCatalogs({
    requirements:reqs,
    observations:[product('plus',129),product('dekamarkt',119,{
      provenance:{ ...source('dekamarkt'), capturedAt:'2026-10-13T01:00:00Z' },
    })], nowMs:now,
  })
  assert.equal(stale.comparable,false)
  assert.equal(stale.reason,'invalid_or_stale_source')
  assert.equal(stale.savingsCents,null)
})

test('equal and zero prices are kept; duplicates and malformed sources withhold result', () => {
  const equal = compareReviewedCatalogs({
    requirements:reqs,observations:[product('plus',0),product('dekamarkt',0)],
    nowMs:now,
  })
  assert.equal(equal.comparable,true)
  assert.equal(equal.cheaperStore,'equal')
  assert.equal(equal.savingsCents,0)
  const dup = compareReviewedCatalogs({
    requirements:reqs,observations:[product('plus',90),product('plus',90),product('dekamarkt',90)],
    nowMs:now,
  })
  assert.equal(dup.comparable,false)
  assert.equal(dup.reason,'invalid_or_stale_source')
  assert.throws(() => compareReviewedCatalogs({
    requirements:[...reqs,...reqs],observations:[],nowMs:now,
  }), /duplicate/)
})

test('offline adapter processes a bounded Product JSON-LD HTML snapshot', () => {
  const html = '<html><script type="application/ld+json">' + JSON.stringify({
    '@context':'https://schema.org','@type':'Product',
    sku:'milk-1',name:'Halfvolle melk',weight:{value:'1000 ml'},
    offers:{'@type':'Offer',price:'1.29',priceCurrency:'EUR',
      availability:'https://schema.org/InStock'},
  }) + '</script></html>'
  const result = parseOfflineRetailerSnapshot({
    source:SOURCES[0], html, capturedAt:'2026-10-15T09:00:00Z',
  })
  assert.equal(result.observations.length,1)
  assert.equal(result.observations[0].currentPriceCents,129)
  assert.equal(result.provenance.sha256.length,64)
  assert.throws(() => parseOfflineRetailerSnapshot({
    source:SOURCES[0],html:'x'.repeat(2*1024*1024+1),
    capturedAt:'2026-10-15T09:00:00Z',
  }),/bounded/)
})

const permissionDoc = {
  version:1,milestone:'M1 Data Feasibility',reviewedAt:'2026-10-14',
  sources:['plus','dekamarkt'].map(supermarket=>({
    supermarket,technicalStatus:'proven',permissionStatus:'permitted',
    productionEnabled:true,
    evidence:[{kind:'written_permission',url:'https://example.org/license',
      finding:'FICTIONAL TEST PERMISSION; NOT REAL APPROVAL'}],
  })),
}

test('live fetch rejects disabled/unapproved source before transport', async () => {
  let calls = 0
  const fetchImpl = async () => {calls++; throw Error('network called')}
  await assert.rejects(fetchAuthorizedRetailerHtml({
    sourceId:'plus-catalog', permissionDocument:permissionDoc,fetchImpl,
  }),/disabled/)
  const blocked = structuredClone(permissionDoc)
  blocked.sources[0].permissionStatus='permission_required'
  blocked.sources[0].productionEnabled=false
  await assert.rejects(fetchAuthorizedRetailerHtml({
    sourceId:'plus-catalog',permissionDocument:blocked,enableLive:true,fetchImpl,
  }),/permission/)
  assert.equal(calls,0)
})

test('authorized network boundary only accepts pinned source, direct HTML and bounded streamed bytes', async () => {
  const expected=SOURCES.find(s=>s.id==='plus-catalog')
  const content = new TextEncoder().encode('<html>fictional</html>')
  let calls = 0
  const mock = async (url,opts)=>{
    calls++
    assert.equal(url,expected.url)
    assert.equal(opts.redirect,'error')
    assert.equal(opts.credentials,'omit')
    return {
      url,status:200,ok:true,
      headers:{get:(k)=> k==='content-type'?'text/html':null},
      body:new ReadableStream({start(c){c.enqueue(content);c.close()}}),
    }
  }
  const result=await fetchAuthorizedRetailerHtml({
    sourceId:'plus-catalog',permissionDocument:permissionDoc,
    enableLive:true,fetchImpl:mock,capturedAtMs:now,
  })
  assert.equal(result.bytes,content.byteLength)
  assert.equal(result.sha256.length,64)
  assert.equal(calls,1)
  await assert.rejects(fetchAuthorizedRetailerHtml({
    sourceId:'not-a-source',permissionDocument:permissionDoc,
    enableLive:true,fetchImpl:mock,
  }),/allowlist/)
  assert.equal(calls,1)
  await assert.rejects(fetchAuthorizedRetailerHtml({
    sourceId:'plus-catalog',permissionDocument:permissionDoc,
    enableLive:true,fetchImpl:async(url)=>({
      url,status:429,ok:false,headers:{get:()=> 'text/html'},
    }),
  }),/unavailable/)
})

test('oversized streamed bytes fail even with missing content-length', async () => {
  const url=SOURCES[0].url
  await assert.rejects(fetchAuthorizedRetailerHtml({
    sourceId:SOURCES[0].id,permissionDocument:permissionDoc,enableLive:true,
    maxBytes:10,fetchImpl:async()=>({
      url,status:200,ok:true,headers:{get:(k)=>k==='content-type'?'text/html':null},
      body:new ReadableStream({start(c){c.enqueue(new Uint8Array(11));c.close()}}),
    }),
  }),/byte limit/)
})
