import assert from 'node:assert/strict'
import test from 'node:test'
import { compareApprovedLocalCatalog } from '../scraper/retailer-compare-approved.mjs'

const refuse=/Private matched retailer comparison refused/
const fields=['query','dbPath','policyPath','sourceGatePath','now','write']
const normal=()=>({
  query:'fake cocoa',dbPath:'unopened.sqlite',
  policyPath:'unread-policy.json',sourceGatePath:'unread-canonical.json',
  now:new Date('2026-10-16T12:00:00.000Z'),
})
test('private comparison rejects all own accessor options before any caller JavaScript',async()=>{
  for(const field of fields){
    let calls=0
    const options=normal()
    Object.defineProperty(options,field,{get(){calls++;throw Error('GETTER MUST NEVER EXECUTE')}})
    await assert.rejects(compareApprovedLocalCatalog(options),refuse)
    assert.equal(calls,0,field)
  }
})
test('private comparison rejects Proxy, revoked Proxy and exotic prototypes without traps',async()=>{
  let traps=0
  const proxy=new Proxy(normal(),{
    get(){traps++;throw Error('GET TRAP MUST NOT EXECUTE')},
    getPrototypeOf(){traps++;throw Error('GETPROTO MUST NOT EXECUTE')},
  })
  await assert.rejects(compareApprovedLocalCatalog(proxy),refuse)
  assert.equal(traps,0)
  const revocable=Proxy.revocable({}, {})
  revocable.revoke()
  await assert.rejects(compareApprovedLocalCatalog(revocable.proxy),refuse)
  const exotic=Object.create({get inheritedTrap(){throw Error('INHERITED NEVER')}})
  Object.assign(exotic,normal())
  await assert.rejects(compareApprovedLocalCatalog(exotic),refuse)
})
test('private comparison refuses hostile Date subclasses and Proxy dates without invoking user code',async()=>{
  let calls=0
  class EvilDate extends Date{
    getTime(){calls++;throw Error('DATE METHOD MUST NOT EXECUTE')}
  }
  const o=normal()
  o.now=new EvilDate('2026-10-16T12:00:00.000Z')
  await assert.rejects(compareApprovedLocalCatalog(o),refuse)
  assert.equal(calls,0)
  const proxy=new Proxy(new Date('2026-10-16T12:00:00.000Z'),{
    get(){calls++;throw Error('DATE PROXY TRAP')}
  })
  o.now=proxy
  await assert.rejects(compareApprovedLocalCatalog(o),refuse)
  assert.equal(calls,0)
})
test('private comparison retains bounded generic refusal for inert wrong data',async()=>{
  for(const options of [null,[],Object.create(Date.prototype),{
    query:null,dbPath:'unopened.sqlite',
    policyPath:'unread-policy.json',now:new Date(),
  }]){
    await assert.rejects(compareApprovedLocalCatalog(options),refuse)
  }
})
