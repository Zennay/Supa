import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchAuthorizedRetailerHtml } from '../scripts/retailer-authorized-fetch.mjs'
import { SOURCES } from '../scripts/m1-capture-sources.mjs'

// No live retailer network call. Fictional rights object only for injected transport.
const fakeRights = {
  version:1, milestone:'M1 Data Feasibility', reviewedAt:'2026-10-14',
  sources:['plus','dekamarkt'].map(supermarket=>({
    supermarket, technicalStatus:'proven', permissionStatus:'permitted',
    productionEnabled:true, evidence:[{kind:'written_permission',
      url:'https://example.org/fictional-license',finding:'MOCK ONLY'}],
  })),
}
const source = SOURCES.find(s => s.id==='plus-catalog')
const capture = (body, maxBytes=10) => fetchAuthorizedRetailerHtml({
  sourceId:source.id, permissionDocument:fakeRights,
  enableLive:true, maxBytes, capturedAtMs:Date.parse('2026-10-15T10:00:00Z'),
  fetchImpl:async()=>({
    url:source.url, status:200, ok:true,
    headers:{get:(name)=>name==='content-type'?'text/html':null},
    body,
  }),
})
test('over-limit HTTP stream cancels underlying reader exactly once on rejection', async () => {
  let cancelled=0
  const body=new ReadableStream({
    start(ctrl) { ctrl.enqueue(new Uint8Array(11)) },
    cancel() { cancelled++ },
  })
  await assert.rejects(capture(body),/byte limit/)
  assert.equal(cancelled,1)
})
test('malformed streamed chunk also cancels a pending response', async () => {
  let cancelled=0
  const body=new ReadableStream({
    start(ctrl) { ctrl.enqueue('not bytes') },
    cancel() { cancelled++ },
  })
  await assert.rejects(capture(body),/Invalid HTML bytes/)
  assert.equal(cancelled,1)
})
test('valid exactly-limit bounded HTML succeeds with SHA and no cancellation', async () => {
  let cancelled=0
  const body=new ReadableStream({
    start(ctrl) { ctrl.enqueue(new TextEncoder().encode('0123456789'));ctrl.close() },
    cancel() { cancelled++ },
  })
  const result=await capture(body)
  assert.equal(result.html,'0123456789')
  assert.equal(result.bytes,10)
  assert.equal(result.sha256.length,64)
  assert.equal(cancelled,0)
})
