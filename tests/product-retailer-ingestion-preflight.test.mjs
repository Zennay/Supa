import test from 'node:test'
import assert from 'node:assert/strict'
import { runApprovedRetailerComparison } from '../scripts/retailer-approved-pipeline.mjs'

// Fictional mock rights only; the actual checked-in source gate remains closed.
const rights={
  version:1,milestone:'M1 Data Feasibility',reviewedAt:'2026-10-14',
  sources:['plus','dekamarkt'].map(supermarket=>({
    supermarket,technicalStatus:'proven',permissionStatus:'permitted',
    productionEnabled:true,evidence:[{kind:'written_permission',
      url:'https://example.org/mock',finding:'Synthetic test only'}],
  })),
}
const req={id:'milk',query:'halfvolle melk',amount:1000,unit:'ml'}
const run = async (requirements) => {
  let calls=0
  const fetchImpl=async()=>{calls++; throw Error('Forbidden third-party transport')}
  await assert.rejects(runApprovedRetailerComparison({
    requirements,permissionDocument:rights,enableLive:true,fetchImpl,
    nowMs:Date.parse('2026-10-15T10:00:00Z'),
  }),/(Invalid comparison input|duplicate|Invalid comparison demand quantity or unit)/)
  assert.equal(calls,0,'invalid basket must not request either store')
}
test('empty and duplicate shopping demand never trigger approved retailer transport',async()=>{
  await run([])
  await run([req,{...req}])
})
test('unusable demand amounts and units fail before any HTTP transport',async()=>{
  for (const invalid of [
    {...req,amount:0}, {...req,amount:-1}, {...req,amount:Number.NaN},
    {...req,unit:'unknown'}, {...req,amount:Number.POSITIVE_INFINITY},
  ]) await run([invalid])
})
