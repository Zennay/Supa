import test from 'node:test'
import assert from 'node:assert/strict'
import { runApprovedRetailerComparison } from '../scripts/retailer-approved-pipeline.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

const now=Date.parse('2026-10-15T10:00:00Z')
const permissionDoc={
  version:1,milestone:'M1 Data Feasibility',reviewedAt:'2026-10-14',
  sources:['plus','dekamarkt'].map(supermarket=>({
    supermarket,technicalStatus:'proven',permissionStatus:'permitted',
    productionEnabled:true,evidence:[{
      kind:'written_permission',url:'https://example.org/fictional-test-license',
      finding:'Only synthetic transport test data, not real source approval',
    }],
  })),
}

function productHtml(price) {
  return '<script type="application/ld+json">'+JSON.stringify({
    '@type':'Product',sku:'milk-1',name:'Halfvolle melk',
    weight:{value:'1000 ml'},offers:{
      '@type':'Offer',price,priceCurrency:'EUR',
      availability:'https://schema.org/InStock',
    },
  })+'</script>'
}

test('opt-in synthetic transport builds both supermarket price lines and a guarded preview', async()=>{
  let calls=0
  const response=async(url,options)=>{
    calls++
    assert.equal(options.redirect,'error')
    assert.equal(options.credentials,'omit')
    const expected= SOURCES.find(s=>s.url===url)
    assert.ok(expected)
    const encoded=new TextEncoder().encode(productHtml(
      expected.supermarket==='plus'?'1.29':'1.19'))
    return {
      url,ok:true,status:200,
      headers:{get:(name)=>name==='content-type'?'text/html':null},
      body:new ReadableStream({start(ctrl){ctrl.enqueue(encoded);ctrl.close()}}),
    }
  }
  const result=await runApprovedRetailerComparison({
    requirements:[{id:'milk',query:'halfvolle melk',amount:1500,unit:'ml'}],
    permissionDocument:permissionDoc,enableLive:true,fetchImpl:response,
    nowMs:now,
  })
  assert.equal(calls,2)
  assert.deepEqual(result.captureSummary.map(s=>s.extractedProducts),[1,1])
  assert.equal(result.comparison.comparable,true)
  assert.equal(result.comparison.cheaperStore,'dekamarkt')
  assert.equal(result.comparison.savingsCents,20)
  assert.equal(result.claimable,false)
  assert.equal(result.comparison.claimable,false)
})

test('pipeline is disabled by default and cannot make any request with blocked rights', async()=>{
  let calls=0
  const transport=async()=>{calls++;throw Error('Unwanted transport')}
  await assert.rejects(runApprovedRetailerComparison({
    requirements:[],permissionDocument:permissionDoc,
    fetchImpl:transport,nowMs:now,
  }),/disabled/)
  assert.equal(calls,0)
  const denied=structuredClone(permissionDoc)
  denied.sources[0].permissionStatus='permission_required'
  denied.sources[0].productionEnabled=false
  await assert.rejects(runApprovedRetailerComparison({
    requirements:[],permissionDocument:denied,enableLive:true,
    fetchImpl:transport,nowMs:now,
  }),/permission/)
  assert.equal(calls,0)
})

test('retailer denial stops serial ingestion with no proxy or fallback requests', async()=>{
  let calls=0
  await assert.rejects(runApprovedRetailerComparison({
    requirements:[{id:'milk',query:'milk',amount:1000,unit:'ml'}],
    permissionDocument:permissionDoc,enableLive:true,nowMs:now,
    fetchImpl:async(url)=>{
      calls++
      return {url,ok:false,status:429,headers:{get:()=>'text/html'}}
    },
  }),/unavailable/)
  assert.equal(calls,1)
})
