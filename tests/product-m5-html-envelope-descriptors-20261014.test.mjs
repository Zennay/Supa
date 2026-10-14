import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

const ERROR=/^Error: Invalid or unbounded inspected HTML shape$/
const SHA='a'.repeat(64)
const MiB=1024*1024
const product={type:['Product'],keys:['@type','name']}
function source(html={hasNextData:false,jsonLd:[product],applicationJsonScripts:[]},
  status='observation') {
  return {
    id:'fake-identity',supermarket:'plus',kind:'product',
    success:true,integrity:'verified',manifestSha256:SHA,html,
    schemaOrgProduct:status==='observation'
      ? {type:'observation',observation:{name:'private-never-read'}}
      : {type:'abstain',reasons:[]},
  }
}
const bad=(s)=>assert.throws(()=>captureShape(s),ERROR)
function mustNotRunGetter(make) {
  let calls=0
  const get=()=>{ calls++; throw new Error('SECRET HTML PATH OR PRICE') }
  bad(make(get))
  assert.equal(calls,0)
}
test('M5 success cannot use own html accessor to forge inspection',()=>{
  mustNotRunGetter((get)=>{
    const s=source()
    Object.defineProperty(s,'html',{get,enumerable:true})
    return s
  })
})
test('M5 success cannot use inherited html inspection',()=>{
  const s=source()
  const prototype=Object.create(null,{html:{value:s.html}})
  Object.setPrototypeOf(s,prototype)
  delete s.html
  bad(s)
})
test('M5 cannot call hasNextData getter',()=>{
  mustNotRunGetter((get)=>{
    const h=source().html
    Object.defineProperty(h,'hasNextData',{get,enumerable:true})
    return source(h)
  })
})
test('M5 cannot call jsonLd getter',()=>{
  mustNotRunGetter((get)=>{
    const h=source().html
    Object.defineProperty(h,'jsonLd',{get,enumerable:true})
    return source(h)
  })
})
test('M5 cannot call applicationJsonScripts getter',()=>{
  mustNotRunGetter((get)=>{
    const h=source().html
    Object.defineProperty(h,'applicationJsonScripts',{get,enumerable:true})
    return source(h)
  })
})
test('M5 refuses inherited inspected hasNextData even when true/false',()=>{
  const h=source().html
  Object.setPrototypeOf(h,{hasNextData:false})
  delete h.hasNextData
  bad(source(h))
})
test('M5 refuses inherited inspected JSON-LD and application script arrays',()=>{
  const json=source().html
  Object.setPrototypeOf(json,{jsonLd:[product]})
  delete json.jsonLd
  bad(source(json))
  const app=source().html
  Object.setPrototypeOf(app,{applicationJsonScripts:[]})
  delete app.applicationJsonScripts
  bad(source(app))
})
test('M5 refuses application/json descriptor slot accessor',()=>{
  mustNotRunGetter((get)=>{
    const app=[{id:null,bytes:1}]
    Object.defineProperty(app,0,{get,enumerable:true,configurable:true})
    return source({hasNextData:false,jsonLd:[product],applicationJsonScripts:app})
  })
})
test('M5 refuses application/json id accessor without invoking it',()=>{
  mustNotRunGetter((get)=>{
    const entry={bytes:1}
    Object.defineProperty(entry,'id',{get,enumerable:true})
    return source({hasNextData:false,jsonLd:[product],applicationJsonScripts:[entry]})
  })
})
test('M5 refuses application/json bytes accessor without invoking it',()=>{
  mustNotRunGetter((get)=>{
    const entry={id:null}
    Object.defineProperty(entry,'bytes',{get,enumerable:true})
    return source({hasNextData:false,jsonLd:[product],applicationJsonScripts:[entry]})
  })
})
test('M5 refuses inherited id or bytes application-json descriptors',()=>{
  const id=Object.assign(Object.create({id:null}),{bytes:1})
  bad(source({hasNextData:false,jsonLd:[product],applicationJsonScripts:[id]}))
  const bytes=Object.assign(Object.create({bytes:1}),{id:null})
  bad(source({hasNextData:false,jsonLd:[product],applicationJsonScripts:[bytes]}))
})
test('M5 refuses sparse application-json descriptor arrays',()=>{
  const entries=Array(1)
  bad(source({hasNextData:false,jsonLd:[product],applicationJsonScripts:entries}))
})
test('M5 preserves exact 8MiB single application-json metadata ceiling',()=>{
  const h={hasNextData:false,jsonLd:[product],applicationJsonScripts:[{id:null,bytes:8*MiB}]}
  assert.equal(captureShape(source(h)).schemaOrgStatus,'candidate_observation')
  h.applicationJsonScripts[0].bytes=8*MiB+1
  bad(source(h))
})
test('M5 refuses over-budget aggregate even if each application-json script is individually valid',()=>{
  bad(source({hasNextData:false,jsonLd:[product],
    applicationJsonScripts:[{id:null,bytes:5*MiB},{id:null,bytes:4*MiB}]}))
})
test('M5 keeps genuine inspected HTML with application/json and Product as P3 only',()=>{
  const html='<html><script id="__NEXT_DATA__" type="application/json">{"sample":1}</script>'+
    '<script type="application/ld+json">{"@type":"Product","name":"Fiction"}</script></html>'
  const result=inspectHtml(html)
  assert.equal(result.applicationJsonScripts.length,1)
  const s=source(result)
  s.manifestSha256=createHash('sha256').update(html).digest('hex')
  const p=captureShape(s)
  assert.equal(p.hasNextData,true)
  assert.equal(p.schemaOrgStatus,'candidate_observation')
  const q=buildOfflineSelectorReviewQueue(compareInspections(
    {sourceCount:1,sources:[s]}, {sourceCount:1,sources:[structuredClone(s)]}))
  assert.equal(q.actions[0].priority,'P3')
  assert.equal(q.productionReady,false)
  assert.equal(q.rightsVerified,false)
  assert.equal(q.m5Eligible,false)
  assert.doesNotMatch(JSON.stringify(q),/private-never-read|fake-identity|Fiction/)
})
test('M5 valid empty HTML summary abstention stays human P2',()=>{
  const s=source({hasNextData:false,jsonLd:[],applicationJsonScripts:[]},'abstain')
  const q=buildOfflineSelectorReviewQueue(compareInspections({sourceCount:1,sources:[s]}))
  assert.equal(q.actions[0].priority,'P2')
  assert.equal(q.m5Eligible,false)
  assert.equal(q.selectorVerified,false)
})
test('M5 failed M1 capture stays unavailable without HTML envelope at all',()=>{
  const s={id:'unavailable',supermarket:'plus',kind:'product',success:false}
  assert.equal(captureShape(s).captureStatus,'unavailable')
  const q=buildOfflineSelectorReviewQueue(compareInspections({sourceCount:1,sources:[s]}))
  assert.equal(q.actions[0].priority,'P1')
  assert.equal(q.m5Eligible,false)
})
test('M5 plain HTML inspection metadata remains unchanged after digest',()=>{
  const s=source({hasNextData:false,jsonLd:[structuredClone(product)],
    applicationJsonScripts:[{id:null,bytes:17}]})
  const before=structuredClone(s)
  const first=captureShape(s)
  const second=captureShape(s)
  assert.equal(first.shapeSha256,second.shapeSha256)
  assert.deepEqual(s,before)
})
