import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { inspectHtml } from '../scripts/m1-inspect-captures.mjs'
import { captureShape, compareInspections } from '../scripts/m5-compare-capture-signatures.mjs'
import { buildOfflineSelectorReviewQueue } from '../scripts/m5-build-selector-review-queue.mjs'

const ERROR=/^Error: Invalid or unbounded inspected HTML shape$/
const sha=(value)=>createHash('sha256').update(value).digest('hex')
// All fragments/observations are fictional; no real retailer requests or prices.
const product={type:['Product'],keys:['@type','name']}
const failure={type:[],keys:[],parseError:true}
function sample(jsonLd=[product],decision='observation') {
  return {
    id:'fictional',supermarket:'plus',kind:'product',
    success:true,integrity:'verified',manifestSha256:'a'.repeat(64),
    html:{hasNextData:false,jsonLd,applicationJsonScripts:[]},
    schemaOrgProduct:decision==='observation'
      ? {type:decision,observation:{name:'private-unused'}}
      : {type:'abstain',reasons:[]},
  }
}
function rejects(value) {
  assert.throws(()=>captureShape(value),ERROR)
}
function throwsWithoutGetter(source, expected=0) {
  let calls=0
  const protect=()=>{ calls++;throw new Error('SECRET SHOULD NOT EXECUTE') }
  source(protect)
  assert.equal(calls,expected)
}
test('M5 refuses JSON-LD type getter without invoking its private payload',()=>{
  throwsWithoutGetter((get)=>{
    const record={keys:['@type','name']}
    Object.defineProperty(record,'type',{get,enumerable:true})
    rejects(sample([record]))
  })
})
test('M5 refuses JSON-LD keys getter without invoking it',()=>{
  throwsWithoutGetter((get)=>{
    const record={type:['Product']}
    Object.defineProperty(record,'keys',{get,enumerable:true})
    rejects(sample([record]))
  })
})
test('M5 refuses JSON-LD parseError getter without invoking it',()=>{
  throwsWithoutGetter((get)=>{
    const record={type:['Product'],keys:['@type']}
    Object.defineProperty(record,'parseError',{get,enumerable:true})
    rejects(sample([record]))
  })
})
test('M5 refuses inherited type metadata even if plausible',()=>{
  const record=Object.assign(Object.create({type:['Product']}),{keys:['@type']})
  rejects(sample([record]))
})
test('M5 refuses inherited keys metadata even if plausible',()=>{
  const record=Object.assign(Object.create({keys:['@type']}),{type:['Product']})
  rejects(sample([record]))
})
test('M5 rejects inherited parseError accessor without executing getter',()=>{
  throwsWithoutGetter((get)=>{
    const record=Object.assign(Object.create(Object.defineProperty({},'parseError',{get})),
      {type:['Product'],keys:['@type']})
    rejects(sample([record]))
  })
})
test('M5 cannot evaluate a getter in the JSON-LD type array',()=>{
  throwsWithoutGetter((get)=>{
    const types=['Product']
    Object.defineProperty(types,'0',{get,enumerable:true,configurable:true})
    rejects(sample([{type:types,keys:['@type']}]))
  })
})
test('M5 cannot evaluate a getter in the JSON-LD keys array',()=>{
  throwsWithoutGetter((get)=>{
    const keys=['@type']
    Object.defineProperty(keys,'0',{get,enumerable:true,configurable:true})
    rejects(sample([{type:['Product'],keys}]))
  })
})
test('M5 cannot evaluate a getter in JSON-LD descriptor array',()=>{
  throwsWithoutGetter((get)=>{
    const rows=[product]
    Object.defineProperty(rows,'0',{get,enumerable:true,configurable:true})
    rejects(sample(rows))
  })
})
test('M5 rejects missing own type even if Object prototype claims one',()=>{
  rejects(sample([{keys:['@type']}]))
})
test('M5 rejects sparse JSON-LD type and keys arrays',()=>{
  const types=['Product'];delete types[0]
  rejects(sample([{type:types,keys:['@type']}]))
  const keys=['@type'];delete keys[0]
  rejects(sample([{type:['Product'],keys}]))
})
test('M5 rejects nontrue own parseError while preserving genuine false-absent M1 descriptors',()=>{
  rejects(sample([{type:[],keys:[],parseError:false}],'abstain'))
  assert.equal(captureShape(sample([{type:[],keys:[]}],'abstain')).schemaOrgStatus,'abstain')
})
test('M5 rejects contradictory parsed Product with parseError true',()=>{
  rejects(sample([{type:['Product'],keys:['@type'],parseError:true}],'abstain'))
})
test('M5 accepts up to 256 own type entries in a single bounded descriptor',()=>{
  const record={type:Array.from({length:255},()=> 'NonProduct').concat('Product'),keys:['@type']}
  assert.equal(captureShape(sample([record])).schemaOrgStatus,'candidate_observation')
})
test('M5 still accepts exactly 128 ordinary M1 parse error descriptors as abstain',()=>{
  const rows=Array.from({length:128},()=>({...failure,type:[],keys:[]}))
  const result=captureShape(sample(rows,'abstain'))
  assert.equal(result.jsonLdCount,128)
  assert.equal(result.jsonLdParseErrors,128)
  assert.equal(result.schemaOrgStatus,'abstain')
})
test('M5 actual inspectHtml output with genuine Product remains P3 human-only',()=>{
  const html='<html><script type="application/ld+json">{"@type":"Product","name":"Fake"}</script></html>'
  const source=sample(inspectHtml(html).jsonLd)
  source.html=inspectHtml(html)
  source.manifestSha256=sha(html)
  const parsed=captureShape(source)
  assert.equal(parsed.schemaOrgStatus,'candidate_observation')
  const comparison=compareInspections({sourceCount:1,sources:[source]},
    {sourceCount:1,sources:[structuredClone(source)]})
  const queue=buildOfflineSelectorReviewQueue(comparison)
  assert.equal(queue.actions[0].priority,'P3')
  assert.equal(queue.rightsVerified,false)
  assert.equal(queue.productionReady,false)
  assert.equal(queue.m5Eligible,false)
  assert.doesNotMatch(JSON.stringify(queue),/private-unused|fictional|Fake/)
})
test('M5 actual malformed M1 JSON-LD stays abstain and never enables selectors',()=>{
  const html='<html><script type="application/ld+json">{bogus</script></html>'
  const source=sample(inspectHtml(html).jsonLd,'abstain')
  source.html=inspectHtml(html)
  source.manifestSha256=sha(html)
  const comparison=compareInspections({sourceCount:1,sources:[source]})
  const queue=buildOfflineSelectorReviewQueue(comparison)
  assert.equal(queue.actions[0].priority,'P2')
  assert.equal(queue.selectorVerified,false)
  assert.equal(queue.rightsVerified,false)
  assert.equal(queue.m5Eligible,false)
})
test('M5 captured plain JSON-LD descriptor arrays are not mutated by hashing',()=>{
  const source=sample([structuredClone(product)])
  const before=structuredClone(source)
  captureShape(source)
  assert.deepEqual(source,before)
})
