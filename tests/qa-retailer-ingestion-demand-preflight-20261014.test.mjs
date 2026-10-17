import test from 'node:test'
import assert from 'node:assert/strict'
import { runApprovedRetailerComparison } from '../scripts/retailer-approved-pipeline.mjs'

/**
 * Independent offline mock proof that clearly malformed/duplicate demand
 * must be rejected before requesting *any* third-party retailer resource.
 * No real retailer request or real permission is performed.
 */
const NOW=Date.parse('2026-10-15T10:00:00.000Z')
const fictionalRights={
  version:1,milestone:'M1 Data Feasibility',reviewedAt:'2026-10-14',
  sources:['plus','dekamarkt'].map(supermarket=>({
    supermarket,technicalStatus:'proven',permissionStatus:'permitted',
    productionEnabled:true,
    evidence:[{kind:'written_permission',url:'https://example.org/fictional-qa-license',
      finding:'Synthetic mock only. Not an actual retailer grant.'}],
  })),
}
function probe() {
  const calls=[]
  const fetchImpl=async url=>{
    calls.push(url)
    const html='<html><body>synthetic non-product document</body></html>'
    const body=new TextEncoder().encode(html)
    return {
      url,status:200,ok:true,
      headers:{get:key=>key==='content-type'?'text/html':null},
      body:new ReadableStream({start(controller){controller.enqueue(body);controller.close()}}),
    }
  }
  return {calls,fetchImpl}
}

test('permission OFF prevents all mock transport calls even for valid demand',async()=>{
  const p=probe()
  await assert.rejects(runApprovedRetailerComparison({
    requirements:[{id:'milk',query:'halfvolle melk',amount:1000,unit:'ml'}],
    permissionDocument:fictionalRights,
    fetchImpl:p.fetchImpl,
    nowMs:NOW,
  }),/disabled/)
  assert.equal(p.calls.length,0)
})

test('EXPECTED RED: empty impossible basket is rejected before any retailer fetch',async()=>{
  const p=probe()
  await assert.rejects(runApprovedRetailerComparison({
    requirements:[],permissionDocument:fictionalRights,
    fetchImpl:p.fetchImpl,enableLive:true,nowMs:NOW,
  }),/Invalid comparison input/)
  assert.equal(p.calls.length,0,
    'zero third-party calls expected when no basket can possibly be assessed')
})

test('EXPECTED RED: duplicate demand identity is rejected before retailer fetch',async()=>{
  const p=probe()
  const req={id:'milk',query:'halfvolle melk',amount:1000,unit:'ml'}
  await assert.rejects(runApprovedRetailerComparison({
    requirements:[req,{...req}],permissionDocument:fictionalRights,
    fetchImpl:p.fetchImpl,enableLive:true,nowMs:NOW,
  }),/duplicate/)
  assert.equal(p.calls.length,0,
    'duplicated recipe requirement must not cause unnecessary remote requests')
})

test('valid demand uses exactly the two pinned source URLs, never a discovery crawl',async()=>{
  const p=probe()
  const report=await runApprovedRetailerComparison({
    requirements:[{id:'milk',query:'halfvolle melk',amount:1000,unit:'ml'}],
    permissionDocument:fictionalRights,
    fetchImpl:p.fetchImpl,enableLive:true,nowMs:NOW,
  })
  assert.deepEqual(p.calls,[
    'https://www.plus.nl/product/zuivelmeester-halfvolle-melk-pak-1000-ml-579010',
    'https://www.dekamarkt.nl/producten/zuivel-kaas/melk-karnemelk/zuivelmeester-halfvolle-melk-1-liter/115873',
  ])
  assert.equal(report.claimable,false)
  assert.equal(report.comparison.claimable,false)
  assert.equal(report.comparison.comparable,false)
})
